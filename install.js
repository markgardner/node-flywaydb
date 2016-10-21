'use strict'

let requestProgress = require('request-progress'),
    ProgressBar = require('progress'),
    extractZip = require('extract-zip'),
    cp = require('child_process'),
    path = require('path'),
    request = require('request'),
    filesize = require('filesize'),
    url = require('url'),
    os = require('os'),
    fs = require('fs'),
    glob = require('glob'),
    env = process.env;

let completedSuccessfully = false,
    sources = {
        'win32': {
            url: 'https://repo1.maven.org/maven2/org/flywaydb/flyway-commandline/4.0.3/flyway-commandline-4.0.3-windows-x64.zip',
            filename: 'flyway-commandline-4.0.3-windows-x64.zip',
            folder: 'flyway-4.0.3'
        },
        'linux': {
            url: 'https://repo1.maven.org/maven2/org/flywaydb/flyway-commandline/4.0.3/flyway-commandline-4.0.3-linux-x64.tar.gz',
            filename: 'flyway-commandline-4.0.3-linux-x64.tar.gz',
            folder: 'flyway-4.0.3'
        },
        'darwin': {
            url: 'https://repo1.maven.org/maven2/org/flywaydb/flyway-commandline/4.0.3/flyway-commandline-4.0.3-macosx-x64.tar.gz',
            filename: 'flyway-commandline-4.0.3-macosx-x64.tar.gz',
            folder: 'flyway-4.0.3'
        }
    },
    currentSource = sources[os.platform()];

process.once('exit', function () {
  if (!completedSuccessfully) {
    console.log('Install did not complete successfully');
    process.exit(1);
  }
});

downloadFlywayWithJre()
    .then(extractToJLib)
    .then(makeResolverFile)
    .then(function() {
        completedSuccessfully = true;
    });

function makeResolverFile(jlibDir) {
    return new Promise(function(res, rej) {
        let javaArgs = [],
            flywayDir = path.join(jlibDir, currentSource.folder);

        if(fs.existsSync(flywayDir)) {
            if(os.platform() === 'linux') {
                javaArgs.push('-Djava.security.egd=file:/dev/../dev/urandom');
            }

            javaArgs.push('-cp');
            javaArgs.push(`"${path.join(flywayDir, 'lib/*')}${path.delimiter}${path.join(flywayDir, 'drivers/*')}"`);
            javaArgs.push('org.flywaydb.commandline.Main');

            fs.writeFileSync(path.join(jlibDir, 'resolver.js'), `module.exports = ${JSON.stringify({
                bin: path.join(flywayDir, 'jre/bin/java'),
                args: javaArgs
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
                    console.error('Error extracting zip');
                    rej();
                } else {
                    res(extractDir);
                }
            });
        });
    } else {
        return new Promise(function(res, rej) {
            console.log('TODO handle tar.gz');
        });
    }
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

    return new Promise(function(resolve, reject) {
        let proxyUrl = env.npm_config_https_proxy || env.npm_config_http_proxy || env.npm_config_proxy,
            downloadOptions = {
                uri: currentSource.url,
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
                fs.writeFileSync(currentSource.filename, body);

                console.log('\nReceived ' + filesize(body.length) + ' total.');

                resolve(currentSource.filename);
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

function getCacheDir() {
  let cacheDirectory = env.NPM_CACHE_DIR || env.npm_config_cache
    , homeDirectory = env.HOME || env.HOMEPATH || env.USERPROFILE;

  if (!cacheDirectory) {
    if (homeDirectory) {
      cacheDirectory = homeDirectory;
    } else {
      cacheDirectory = '/tmp';
    }
  }

  cacheDirectory = path.join(cacheDirectory, 'node-flywaydb');

  if (!fs.existsSync(cacheDirectory)) {
    fs.mkdirSync(cacheDirectory);
  }

  return cacheDirectory;
}