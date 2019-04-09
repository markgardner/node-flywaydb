const path = require('path');
const fs = require('fs');
const os = require('os');
const request = require('request');
const parseXmlString = require('xml2js').parseString;
const extractZip = require('extract-zip');
const spawn = require('child_process').spawn;

const ONE_DAY_MS = 8.64e+7;

function downloadOptions(url) {
    const env = process.env;

    return {
        uri: url,
        encoding: null, // Get response as a buffer
        followRedirect: true,
        headers: {
            'User-Agent': env.npm_config_user_agent
        },
        strictSSL: true,
        proxy: (
            env.npm_config_https_proxy ||
            env.npm_config_proxy ||
            env.npm_config_http_proxy ||
            env.HTTPS_PROXY ||
            env.https_proxy ||
            env.HTTP_PROXY ||
            env.http_proxy
        )
    };
}

function saveCachedUrlToPath(destinationPath, url) {
    const stats = fs.existsSync(destinationPath) ? fs.statSync(destinationPath) : null;
    const useCachedVersion = stats && Date.now() - stats.mtimeMs < ONE_DAY_MS;

    if(useCachedVersion) {
        return Promise.resolve(destinationPath);
    }

    return new Promise(function(resolve, reject) {
        console.log('DOWNLOADING', url);

        request(downloadOptions(url))
            .pipe(fs.createWriteStream(destinationPath))
            .on('response', function(response) {
                if(response.statusCode !== 200) {
                    const err = new Error('Request failed for ' + url + ' - ' + response.statusCode);
                    err.statusCode = response.statusCode;
                    err.type = 'HTTP_ERROR';

                    reject(err);
                }
            })
            .on('finish', function() {
                resolve(destinationPath);
            })
            .on('error', reject);
    });
}

function nodePlatformToMavinSuffix() {
    return ({
        'win32': 'windows-x64.zip',
        'linux': 'linux-x64.tar.gz',
        'darwin': 'macosx-x64.tar.gz'
    })[os.platform()];
}

function resolveMavenVersion(libDir, groupId, artifactId, version) {
    if(version && version !== 'latest') {
        return Promise.resolve(version);
    } else {
        const latestCacheFile = path.join(libDir, `${groupId}_${artifactId}.latest`);
        const xmlReqeust = saveCachedUrlToPath(latestCacheFile, `https://repo1.maven.org/maven2/${groupId.replace(/\./g, '/')}/${artifactId}/maven-metadata.xml`);

        return xmlReqeust
            .then(function(manifestFilePath) {
                return new Promise(function(resolve, reject) {
                    const manifestContent = fs.readFileSync(manifestFilePath, { encoding: 'utf8' });

                    parseXmlString(manifestContent, function(err, result) {
                        if(err) {
                            reject(err);
                        } else {
                            const nonTestVersions = result.metadata.versioning[0].versions[0].version.filter(function(version) { return version.match(/^[1-9]\.[0-9.]+$/); });

                            if(!nonTestVersions.length) {
                                reject(new Error(`Stable version of ${groupId}_${artifactId} not found`));
                            } else {
                                resolve(nonTestVersions[nonTestVersions.length - 1]);
                            }
                        }
                    });
                });
            });
    }
}

function downloadMaven(libDir, groupId, artifactId, version) {
    return resolveMavenVersion(libDir, groupId, artifactId, version)
        .then(function(version) {
            if(version.match(/^https/)) {
                const flywaySavePath = path.join(libDir, path.basename(version));

                return saveCachedUrlToPath(flywaySavePath, version)
                    .then(function (fileSavePath) {
                        return {
                            version,
                            type: 'asset',
                            file: fileSavePath,
                        };
                    });
            } else if(artifactId === 'flyway-commandline') {
                const platformSuffix = nodePlatformToMavinSuffix();
                const flywayUrl = `https://repo1.maven.org/maven2/${groupId.replace(/\./g, '/')}/${artifactId}/${version}/${artifactId}-${version}-${platformSuffix}`;
                const flywaySavePath = path.join(libDir, `${artifactId}-${version}-${platformSuffix}`);

                return saveCachedUrlToPath(flywaySavePath, flywayUrl)
                    .then(function (fileSavePath) {
                        return {
                            version,
                            type: 'command',
                            file: fileSavePath,
                        };
                    });
            } else {
                // Assume non-flyway dependencies are simple jar files
                const depUrl = `https://repo1.maven.org/maven2/${groupId.replace(/\./g, '/')}/${artifactId}/${version}/${artifactId}-${version}.jar`;
                const depSavePath = path.join(libDir, `${artifactId}-${version}.jar`);

                return saveCachedUrlToPath(depSavePath, depUrl)
                    .then(function (fileSavePath) {
                        return {
                            version,
                            type: 'asset',
                            file: fileSavePath,
                        };
                    });
            }
        })
        .then(function({ version, type, file }) {
            const extractDir = path.join(libDir, `${artifactId}-${version}`);
            const fileExt = path.extname(file);

            if(fileExt === '.zip' || fileExt === '.gz' || fileExt === '.xz') {
                if(fs.existsSync(extractDir)) {
                    return { version, type, dir: extractDir };
                } else {
                    fs.mkdirSync(extractDir);

                    if(fileExt === '.zip') {
                        return new Promise(function(res, rej) {
                            extractZip(file, { dir: extractDir }, function(err) {
                                if(err) {
                                    fs.rmdirSync(extractDir);

                                    rej(err);
                                } else {
                                    res({ version, type, dir: extractDir });
                                }
                            });
                        });
                    } else {
                        return new Promise(function(res, rej) {
                            spawn('tar', ['zxf', file], {
                                cwd: extractDir,
                                stdio: 'inherit'
                            }).on('close', function(code) {
                                if(code === 0) {
                                    res({ version, type, dir: extractDir });
                                } else {
                                    fs.rmdirSync(extractDir);

                                    rej(new Error('Untaring file failed ' + code));
                                }
                            });
                        });
                    }
                }
            } else {
                return { version, type, file };
            }
        });
}

function ensureWritableLibDir() {
    const libDir = path.resolve(__dirname, '../jlib');

    if(!fs.existsSync(libDir)) {
        fs.mkdirSync(libDir);
    } else {
        fs.accessSync(libDir, fs.constants.W_OK);
    }

    return libDir;
}

module.exports = {
    ensureArtifacts: function(config, callback) {
        const libDir = ensureWritableLibDir();
        var pendingDownloads = [downloadMaven(libDir, 'org.flywaydb', 'flyway-commandline', config.downloadUrl || config.version)];

        if(config.mavinPlugins) {
            pendingDownloads = pendingDownloads.concat(config.mavinPlugins.map(function(plugin) {
                return downloadMaven(libDir, plugin.groupId, plugin.artifactId, plugin.downloadUrl || plugin.version);
            }));
        }

        Promise.all(pendingDownloads)
            .then(function(assets) {
                callback(null, path.join(assets[0].dir, `flyway-${assets[0].version}`, 'flyway'));
            })
            .catch(callback);
    }
};
