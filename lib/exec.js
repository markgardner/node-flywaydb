const download = require('./download');
const spawn = require('child_process').spawn;
const fs = require('fs');
const os = require('os');

function configFlywayArgs(config) {
    const flywayArgs = config.flywayArgs || {};
    const flywayArgsKeys = Object.keys(flywayArgs);

    return flywayArgsKeys.map(function(key) {
        return `-${key}=${flywayArgs[key]}`;
    });
}

function binIsFile(path) {
    const stats = fs.statSync(path);

    return !!stats && stats.isFile();
}

function exeCommand(config, cmd) { 
    download.ensureArtifacts(config, function(err, flywayBin) {
        const workingDir = process.cwd();

        if(err) {
            throw new Error(err);
        }

        // Ensure that the flywayBin is a file, helps with security risk of having
        // shell true in the spawn call below
        if (!binIsFile(flywayBin)) {
            throw new Error('Flyway bin was not found at "' + flywayBin + '"');
        }

        const args = configFlywayArgs(config)
            .concat([cmd._name]);

        // Fix problem with spaces on windows OS
        // https://github.com/nodejs/node/issues/7367
        const isWindowsAndHasSpace = !!(flywayBin.match(/\s/) && os.platform() === 'win32');
        const safeSpawnBin = isWindowsAndHasSpace ? '"' + flywayBin + '"' : flywayBin;

        const child = spawn(safeSpawnBin, args, {
            env: Object.assign({}, process.env, config.env),
            cwd: workingDir,
            stdio: 'inherit',
            windowsVerbatimArguments: true, // Super Weird, https://github.com/nodejs/node/issues/5060
            shell: isWindowsAndHasSpace,
        });

        child.on('close', code => {
            process.exit(code);
        });
    });
};

module.exports = {
    exeCommand: function(config) { exeCommand(config) }
};