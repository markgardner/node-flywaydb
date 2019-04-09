# node-flywaydb
NodeJs wrapper for [flywaydb cli](https://flywaydb.org/documentation/commandline/)

## Motivation
I found myself wanting to use flyway on my build systems and dreading installing and maintaining the cli with all of the PATH requirements. This simple wrapper will download the latest Flyway cli on install and provide a hook for your package scripts.

## Example package script
```
"scripts": {
  "migrate": "flyway -c conf/flyway.js migrate"
}
```

See [Example config file for inspiration](sample/config.js)
