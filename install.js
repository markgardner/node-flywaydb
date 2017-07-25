'use strict'

let requestProgress = require('request-progress'),
    ProgressBar = require('progress'),
    extractZip = require('extract-zip'),
    spawn = require('child_process').spawn,
    path = require('path'),
    request = require('request'),
    filesize = require('filesize'),
    url = require('url'),
    os = require('os'),
    fs = require('fs'),
    flywayVersion = '4.0.3',
    slf4jVersion = '1.7.25',
    env = process.env;

let completedSuccessfully = false,
    sources = {
        'win32': {
            url: `https://repo1.maven.org/maven2/org/flywaydb/flyway-commandline/${flywayVersion}/flyway-commandline-${flywayVersion}-windows-x64.zip`,
            filename: `flyway-commandline-${flywayVersion}-windows-x64.zip`,
            folder: `flyway-${flywayVersion}`
        },
        'linux': {
            url: `https://repo1.maven.org/maven2/org/flywaydb/flyway-commandline/${flywayVersion}/flyway-commandline-${flywayVersion}-linux-x64.tar.gz`,
            filename: `flyway-commandline-${flywayVersion}-linux-x64.tar.gz`,
            folder: `flyway-${flywayVersion}`
        },
        'darwin': {
            url: `https://repo1.maven.org/maven2/org/flywaydb/flyway-commandline/${flywayVersion}/flyway-commandline-${flywayVersion}-macosx-x64.tar.gz`,
            filename: `flyway-commandline-${flywayVersion}-macosx-x64.tar.gz`,
            folder: `flyway-${flywayVersion}`
        }
    },
    currentSource = sources[os.platform()],
    platformParamEnclosureChar = os.platform() === 'win32' ? '"' : "'";

process.once('exit', function () {
  if (!completedSuccessfully) {
    console.log('Install did not complete successfully');
    process.exit(1);
  }
});

downloadFlywayWithJre()
    .then(extractToJLib)
    .then(makeResolverFile)
    .then(downloadSlf4jJarsToJLib)
    .then(function() {
        completedSuccessfully = true;
    }, function(err) {
        console.log(err);
    });

function makeResolverFile(jlibDir) {
    return new Promise(function(res, rej) {
        let argsPrefix = [],
            flywayDir = path.join(jlibDir, currentSource.folder);

        if(fs.existsSync(flywayDir)) {
            if(os.platform() === 'linux') {
                argsPrefix = ['-Djava.security.egd=file:/dev/../dev/urandom'];
            }

            fs.writeFileSync(path.join(jlibDir, 'resolver.js'), `module.exports = ${JSON.stringify({
                bin: path.join(flywayDir, 'jre/bin/java'),
                argsPrefix: argsPrefix,
                libDirs: [path.join(flywayDir, 'lib/*'), path.join(flywayDir, 'drivers/*')]
            }, null, 2)};`);

            res();
        } else {
            rej(new Error('flywayDir was not found at ' + flywayDir));
        }
    });
}

function extractToJLib(compressedFlywaySource) {
    let extractDir = path.join(__dirname, 'jlib');

    if(!fs.existsSync(extractDir)) {
        fs.mkdirSync(extractDir);
    } else {
        return Promise.resolve(extractDir);
    }

    if(path.extname(compressedFlywaySource) === '.zip') {
        return new Promise(function(res, rej) {
            extractZip(compressedFlywaySource, { dir: extractDir }, function(err) {
                if(err) {
                    console.error('Error extracting zip', err);
                    rej();
                } else {
                    res(extractDir);
                }
            });
        });
    } else {
        return new Promise(function(res, rej) {
            spawn('tar', ['zxf', compressedFlywaySource], {
                cwd: extractDir,
                stdio: 'inherit'
            }).on('close', function(code) {
                if(code === 0) {
                    res(extractDir);
                } else {
                    console.log('Untaring file failed', code);
                    rej();
                }
            });
        });
    }
}

function downloadUrlToFile(url, filename) {
    return new Promise(function(resolve, reject) {
        let proxyUrl = env.npm_config_https_proxy || env.npm_config_http_proxy || env.npm_config_proxy,
            downloadOptions = {
                uri: url,
                encoding: null, // Get response as a buffer
                followRedirect: true,
                headers: {
                    'User-Agent': env.npm_config_user_agent
                },
                strictSSL: true,
                proxy: proxyUrl
            },
            consoleDownloadBar;

        requestProgress(request(downloadOptions, function (error, response, body) {
            if (!error && response.statusCode === 200) {
                fs.writeFileSync(filename, body);

                console.log('\nReceived ' + filesize(body.length) + ' total.');

                resolve(filename);
            } else if (response) {
                console.error(`
    Error requesting archive.
    Status: ${response.statusCode}
    Request options: ${JSON.stringify(downloadOptions, null, 2)}
    Response headers: ${JSON.stringify(response.headers, null, 2)}
    Make sure your network and proxy settings are correct.

    If you continue to have issues, please report this full log at https://github.com/markgardner/node-flywaydb`);
                process.exit(1);
            } else {
                console.error('Error downloading archive: ', error);
                process.exit(1);
            }
        }))
        .on('progress', function (state) {
            try {
                if (!consoleDownloadBar) {
                    consoleDownloadBar = new ProgressBar('  [:bar] :percent', { total: state.size.total, width: 40 });
                }

                consoleDownloadBar.curr = state.size.transferred;
                consoleDownloadBar.tick();
            } catch (e) {
                console.log('error', e);
            }
        });
    });
}

function downloadFlywayWithJre() {
    let downloadDir = getCacheDir();

    if(!currentSource) {
        throw new Error('Your platform is not supported');
    }

    currentSource.filename = path.join(downloadDir, currentSource.filename);

    if(fs.existsSync(currentSource.filename)) {
        return Promise.resolve(currentSource.filename);
    }

    console.log('Downloading', currentSource.url);
    console.log('Saving to', currentSource.filename);

    return downloadUrlToFile(currentSource.url, currentSource.filename);
}

function downloadSlf4jJarsToJLib(jlibDir) {
    const destinationDir = path.join(__dirname, `jlib/flyway-${flywayVersion}/lib`),
          apiFilename = path.join(destinationDir, `slf4j-api-${slf4jVersion}.jar`),
          implFilename = path.join(destinationDir, `slf4j-jdk14-${slf4jVersion}.jar`),
          apiUrl = `http://repo1.maven.org/maven2/org/slf4j/slf4j-api/${slf4jVersion}/slf4j-api-${slf4jVersion}.jar`,
          implUrl = `http://repo1.maven.org/maven2/org/slf4j/slf4j-jdk14/${slf4jVersion}/slf4j-jdk14-${slf4jVersion}.jar`;

    if(fs.existsSync(apiFilename) && fs.existsSync(implFilename)) {
        return Promise.resolve(jlibDir);
    }

    console.log('Downloading', apiUrl);
    console.log('Saving to', apiFilename);

    return downloadUrlToFile(apiUrl, apiFilename).then(function () {
        console.log('Downloading', implUrl);
        console.log('Saving to', implFilename);

        return downloadUrlToFile(implUrl, implFilename);
    });
}

function getCacheDir() {
    var tmpDirs = [
            process.env.npm_config_tmp,
            os.tmpdir(),
            path.join(process.cwd(), 'tmp')
        ],
        writeAbleTmpDir = tmpDirs.find(dir => {
            if(dir) {
                try {
                    dir = path.resolve(dir, 'node-flywaydb');

                    if(!fs.existsSync(dir)) {
                        fs.mkdirSync(dir, '0777');
                        fs.chmodSync(dir, '0777');
                    }

                    let tmpFile = path.join(dir, Date.now() + '.tmp');
                    fs.writeFileSync(tmpFile, 'test');
                    fs.unlinkSync(tmpFile);

                    return true;
                } catch(e) {
                    console.log(dir, 'is not writable:', e);
                }
            }

            return false;
        });

    if(writeAbleTmpDir) {
        return path.resolve(writeAbleTmpDir, 'node-flywaydb');
    } else {
        console.error('Can not find a writable tmp directory.');
        exit(1);
    }
}