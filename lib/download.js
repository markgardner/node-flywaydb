const path = require('path');
const fs = require('fs');
const os = require('os');
const {parse: parseUrl} = require('url');
const parseXmlString = require('xml2js').parseString;
const extractZip = require('extract-zip');
const spawn = require('child_process').spawn;

const ONE_DAY_MS = 8.64e+7;
const NEVER_EXPIRE_DOWNLOADS = -1;

function createProxyAgent(protocol, env) {
    if (protocol === 'http:') {
        const proxy = env.npm_config_proxy ||
            env.npm_config_http_proxy ||
            env.HTTP_PROXY ||
            env.http_proxy ||
            env.npm_config_proxy;

        if (proxy) {
            const HttpProxyAgent = require('http-proxy-agent');

            return new HttpProxyAgent(proxy);
        }
    } else if (protocol === 'https:') {
        const proxy = env.npm_config_https_proxy ||
            env.HTTPS_PROXY ||
            env.https_proxy ||
            env.npm_config_proxy;

        if (proxy) {
            const HttpsProxyAgent = require('https-proxy-agent');

            return new HttpsProxyAgent(proxy);
        }
    }
}

function createRequest(options, agent, callback) {
    var client;

    if (options.protocol === 'http:') {
        client = require('http');

        if (!options.port) {
            options.port = 80;
        }
    } else if (options.protocol === 'https:') {
        client = require('https');

        if (!options.port) {
            options.port = 443;
        }
    } else {
        return false;
    }

    options.method = 'GET';
    options.agent = agent;

    const req = client.request(options, callback);
    req.end();

    return true;
}

function saveCachedUrlToPath(destinationPath, url, downloadExpirationTimeMs) {
    const expirationTime = downloadExpirationTimeMs || ONE_DAY_MS;
    const stats = fs.existsSync(destinationPath) ? fs.statSync(destinationPath) : null;
    const useCachedVersion = stats && (expirationTime === NEVER_EXPIRE_DOWNLOADS || (Date.now() - stats.mtimeMs < expirationTime));

    if(useCachedVersion) {
        return Promise.resolve(destinationPath);
    }

    console.log('DOWNLOADING', url);

    return new Promise(function(resolve, reject) {
        const options = parseUrl(url);

        // Only returns an agent if the proxy env is provided.
        const agent = createProxyAgent(options.protocol, process.env);

        const requestSent = createRequest(options, agent, function(fileRes) {
            if (fileRes.statusCode !== 200) {
                const err = new Error('Request failed for ' + url + ' - ' + fileRes.statusCode);

                err.statusCode = fileRes.statusCode;
                err.type = 'HTTP_ERROR';

                reject(err);
            } else {
                const fileWriter = fs.createWriteStream(destinationPath);

                fileRes.on('error', reject);
                fileRes.on('end', function() {
                    fileWriter.end(function() {
                        resolve(destinationPath);
                    });
                });

                fileRes.pipe(fileWriter);
            }
        });

        if (!requestSent) {
            reject(new Error('Unsupported download protocol'));
        }
    });
}

function nodePlatformToMavinSuffix() {
    return ({
        'win32': 'windows-x64.zip',
        'linux': 'linux-x64.tar.gz',
        'darwin': 'macosx-x64.tar.gz'
    })[os.platform()];
}

function resolveMavenVersion(libDir, groupId, artifactId, version, downloadExpirationTimeMs) {
    if(version && version !== 'latest') {
        return Promise.resolve(version);
    } else {
        const latestCacheFile = path.join(libDir, `${groupId}_${artifactId}.latest`);
        const xmlReqeust = saveCachedUrlToPath(latestCacheFile, `https://repo1.maven.org/maven2/${groupId.replace(/\./g, '/')}/${artifactId}/maven-metadata.xml`, downloadExpirationTimeMs);

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

function downloadMaven(libDir, groupId, artifactId, version, downloadExpirationTimeMs) {
    return resolveMavenVersion(libDir, groupId, artifactId, version, downloadExpirationTimeMs)
        .then(function(version) {
            if(version.match(/^https/)) {
                const flywaySavePath = path.join(libDir, path.basename(version));

                return saveCachedUrlToPath(flywaySavePath, version, downloadExpirationTimeMs)
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

                return saveCachedUrlToPath(flywaySavePath, flywayUrl, downloadExpirationTimeMs)
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

                return saveCachedUrlToPath(depSavePath, depUrl, downloadExpirationTimeMs)
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

function ensureWritableLibDir(libDir) {
    if(!libDir) {
        libDir = path.resolve(__dirname, '../jlib');
    } else if(!path.isAbsolute(libDir)) {
        libDir = path.resolve(libDir);
    }

    if(!fs.existsSync(libDir)) {
        fs.mkdirSync(libDir);
    } else {
        fs.accessSync(libDir, fs.constants.W_OK);
    }

    return libDir;
}

module.exports = {
    ensureArtifacts: function(config, callback) {
        const libDir = ensureWritableLibDir(config.downloads && config.downloads.storageDirectory);
        const downloadExpirationTimeMs = config.downloads && config.downloads.expirationTimeInMs;
        var pendingDownloads = [downloadMaven(libDir, 'org.flywaydb', 'flyway-commandline', config.downloadUrl || config.version, downloadExpirationTimeMs)];

        if(config.mavinPlugins) {
            pendingDownloads = pendingDownloads.concat(config.mavinPlugins.map(function(plugin) {
                return downloadMaven(libDir, plugin.groupId, plugin.artifactId, plugin.downloadUrl || plugin.version, downloadExpirationTimeMs);
            }));
        }

        Promise.all(pendingDownloads)
            .then(function(assets) {
                const binFile = os.platform() === 'win32'
                    ? 'flyway.cmd'
                    : 'flyway';

                callback(null, path.join(assets[0].dir, `flyway-${assets[0].version}`, binFile));
            })
            .catch(callback);
    }
};
