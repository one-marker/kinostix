#!/usr/bin/env node

var optimist = require('optimist')
var rc = require('rc')
var clivas = require('clivas')
var numeral = require('numeral')
var os = require('os')
var address = require('network-address')
var proc = require('child_process')
var peerflix = require('./')
var keypress = require('keypress')
var inquirer = require('inquirer')
var parsetorrent = require('parse-torrent')
var bufferFrom = require('buffer-from')

process.title = 'peerflix'

var argv = rc('peerflix', {}, optimist
  .usage('Usage: $0 magnet-link-or-torrent [options]')
  .alias('c', 'connections').describe('c', 'max connected peers').default('c', os.cpus().length > 1 ? 100 : 30)
  .alias('p', 'port').describe('p', 'change the http port').default('p', 8888)
  .alias('u', 'url').describe('u', 'change the http url').default('u', '/')
  .alias('i', 'index').describe('i', 'changed streamed file (index)')
  .alias('l', 'list').describe('l', 'list available files with corresponding index').boolean('l')
  .alias('t', 'subtitles').describe('t', 'load subtitles file')
  .alias('q', 'quiet').describe('q', 'be quiet').boolean('v')
  .alias('j', 'jack').describe('j', 'autoplay in omx** using the audio jack').boolean('j')
  .alias('f', 'path').describe('f', 'change buffer file path')
  .alias('b', 'blocklist').describe('b', 'use the specified blocklist')
  .alias('n', 'no-quit').describe('n', 'do not quit peerflix on vlc exit').boolean('n')
  .alias('a', 'all').describe('a', 'select all files in the torrent').boolean('a')
  .alias('r', 'remove').describe('r', 'remove files on exit').boolean('r')
  .alias('h', 'hostname').describe('h', 'host name or IP to bind the server to')
  .alias('e', 'peer').describe('e', 'add peer by ip:port')
  .alias('x', 'peer-port').describe('x', 'set peer listening port')
  .alias('d', 'not-on-top').describe('d', 'do not float video on top').boolean('d')
  .describe('on-downloaded', 'script to call when file is 100% downloaded')
  .describe('on-listening', 'script to call when server goes live')
  .describe('version', 'prints current version').boolean('boolean')
  .argv)

if (argv.version) {
  console.error(require('./package').version)
  process.exit(0)
}

var filename = argv._[0]

if (!filename) {
  optimist.showHelp()
  console.error('Options passed after -- will be passed to your player')
  console.error('')
  console.error('  "peerflix magnet-link --vlc -- --fullscreen" will pass --fullscreen to vlc')
  console.error('')
  console.error('* Autoplay can take several seconds to start since it needs to wait for the first piece')
  console.error('** OMX player is the default Raspbian video player\n')
  process.exit(1)
}

var watchVerifying = function (engine) {
  var showVerifying = function (i) {
    var percentage = Math.round(((i + 1) / engine.torrent.pieces.length) * 100.0)
    clivas.clear()
    clivas.line('{yellow:Verifying downloaded:} ' + percentage + '%')
  }

  var startShowVerifying = function () {
    showVerifying(-1)
    engine.on('verify', showVerifying)
  }

  var stopShowVerifying = function () {
    clivas.clear()
    engine.removeListener('verify', showVerifying)
    engine.removeListener('verifying', startShowVerifying)
  }

  engine.on('verifying', startShowVerifying)
  engine.on('ready', stopShowVerifying)
}

var ontorrent = function (torrent) {
  if (argv['peer-port']) argv.peerPort = Number(argv['peer-port'])

  var engine = peerflix(torrent, argv)
  var hotswaps = 0
  var verified = 0
  var invalid = 0
  var airplayServer = null
  var downloadedPercentage = 0

  engine.on('verify', function () {
    verified++
    downloadedPercentage = Math.floor(verified / engine.torrent.pieces.length * 100)
  })

  engine.on('invalid-piece', function () {
    invalid++
  })

  var bytes = function (num) {
    return numeral(num).format('0.0b')
  }

  if (argv.list) {
    var interactive = process.stdout.isTTY && process.stdin.isTTY && !!process.stdin.setRawMode

    var onready = function () {
      if (interactive) {
        var filenamesInOriginalOrder = engine.files.map(file => file.path)
        inquirer.prompt([{
          type: 'list',
          name: 'file',
          message: 'Choose one file',
          choices: Array.from(engine.files)
            .sort((file1, file2) => file1.path.localeCompare(file2.path))
            .map(function (file, i) {
              return {
                name: file.name + ' : ' + bytes(file.length),
                value: filenamesInOriginalOrder.indexOf(file.path)
              }
            })
        }]).then(function (answers) {
          argv.index = answers.file
          delete argv.list
          ontorrent(torrent)
        })
      } else {
        engine.files.forEach(function (file, i, files) {
          clivas.line('{3+bold:' + i + '} : {magenta:' + file.name + '} : {blue:' + bytes(file.length) + '}')
        })
        process.exit(0)
      }
    }

    if (engine.torrent) onready()
    else {
      watchVerifying(engine)
      engine.on('ready', onready)
    }
    return
  }

  engine.on('hotswap', function () {
    hotswaps++
  })

  var started = Date.now()
  var wires = engine.swarm.wires
  var swarm = engine.swarm

  var active = function (wire) {
    return !wire.peerChoking
  }

  var peers = [].concat(argv.peer || [])
  peers.forEach(function (peer) {
    engine.connect(peer)
  })

  if (argv['on-downloaded']) {
    var downloaded = false
    engine.on('uninterested', function () {
      if (!downloaded) proc.exec(argv['on-downloaded'])
      downloaded = true
    })
  }

  engine.server.on('listening', function () {

    var host = argv.hostname || address()
    var href = 'http://' + host + ':' + engine.server.address().port + argv.url
    var filename = engine.server.index.name.split('/').pop().replace(/\{|\}/g, '')
    var filelength = engine.server.index.length
    var player = null
    var paused = false
    var timePaused = 0
    var pausedAt = null


    if (argv.all) {
      filename = engine.torrent.name
      filelength = engine.torrent.length
      href += '.m3u'
    }

    if (argv['on-listening']) proc.exec(argv['on-listening'] + ' ' + href)

    if (argv.quiet) return console.log('server is listening on ' + href)

    process.stdout.write(bufferFrom('G1tIG1sySg==', 'base64')) // clear for drawing

    var interactive = !player && process.stdin.isTTY && !!process.stdin.setRawMode

    if (interactive) {
      keypress(process.stdin)
      process.stdin.on('keypress', function (ch, key) {
        if (!key) return
        if (key.name === 'c' && key.ctrl === true) return process.kill(process.pid, 'SIGINT')
        if (key.name === 'l' && key.ctrl === true) {
          var command = 'xdg-open'
          if (process.platform === 'win32') { command = 'explorer' }
          if (process.platform === 'darwin') { command = 'open' }

          return proc.exec(command + ' ' + engine.path)
        }
        if (key.name !== 'space') return

        if (player) return
        if (paused === false) {
          if (!argv.all) {
            engine.server.index.deselect()
          } else {
            engine.files.forEach(function (file) {
              file.deselect()
            })
          }
          paused = true
          pausedAt = Date.now()
          draw()
          return
        }

        if (!argv.all) {
          engine.server.index.select()
        } else {
          engine.files.forEach(function (file) {
            file.select()
          })
        }

        paused = false
        timePaused += Date.now() - pausedAt
        draw()
      })
      process.stdin.setRawMode(true)
    }

    var draw = function () {
      var unchoked = engine.swarm.wires.filter(active)
      var timeCurrentPause = 0
      if (paused === true) {
        timeCurrentPause = Date.now() - pausedAt
      }
      var runtime = Math.floor((Date.now() - started - timePaused - timeCurrentPause) / 1000)
      var linesremaining = clivas.height
      var peerslisted = 0

      clivas.clear()
      if (argv.airplay) {
        if (airplayServer) clivas.line('{green:streaming to} {bold:' + airplayServer.name + '} {green:using airplay}')
        else clivas.line('{green:streaming} {green:using airplay}')
      } else {
        clivas.line('{green:open} {bold:' + (player || 'vlc') + '} {green:and enter} {bold:' + href + '} {green:as the network address}')
      }
      clivas.line('')
      clivas.line('{yellow:info} {green:streaming} {bold:' + filename + ' (' + bytes(filelength) + ')} {green:-} {bold:' + bytes(swarm.downloadSpeed()) + '/s} {green:from} {bold:' + unchoked.length + '/' + wires.length + '} {green:peers}    ')
      clivas.line('{yellow:info} {green:path} {cyan:' + engine.path + '}')
      clivas.line('{yellow:info} {green:downloaded} {bold:' + bytes(swarm.downloaded) + '} (' + downloadedPercentage + '%) {green:and uploaded }{bold:' + bytes(swarm.uploaded) + '} {green:in }{bold:' + runtime + 's} {green:with} {bold:' + hotswaps + '} {green:hotswaps}     ')
      clivas.line('{yellow:info} {green:verified} {bold:' + verified + '} {green:pieces and received} {bold:' + invalid + '} {green:invalid pieces}')
      clivas.line('{yellow:info} {green:peer queue size is} {bold:' + swarm.queued + '}')
      clivas.line('{80:}')

      if (interactive) {
        var openLoc = ' or CTRL+L to open download location}'
        if (paused) clivas.line('{yellow:PAUSED} {green:Press SPACE to continue download' + openLoc)
        else clivas.line('{50+green:Press SPACE to pause download' + openLoc)
      }

      clivas.line('')
      linesremaining -= 9

      wires.every(function (wire) {
        var tags = []
        if (wire.peerChoking) tags.push('choked')
        clivas.line('{25+magenta:' + wire.peerAddress + '} {10:' + bytes(wire.downloaded) + '} {10 + cyan:' + bytes(wire.downloadSpeed()) + '/s} {15 + grey:' + tags.join(', ') + '}   ')
        peerslisted++
        return linesremaining - peerslisted > 4
      })
      linesremaining -= peerslisted

      if (wires.length > peerslisted) {
        clivas.line('{80:}')
        clivas.line('... and ' + (wires.length - peerslisted) + ' more     ')
      }

      clivas.line('{80:}')
      clivas.flush()
    }

    setInterval(draw, 500)
    draw()
  })

  engine.server.once('error', function () {
    engine.server.listen(0, argv.hostname)
  })

  var onmagnet = function () {
    clivas.clear()
    clivas.line('{green:fetching torrent metadata from} {bold:' + engine.swarm.wires.length + '} {green:peers}')
  }

  if (typeof torrent === 'string' && torrent.indexOf('magnet:') === 0 && !argv.quiet) {
    onmagnet()
    engine.swarm.on('wire', onmagnet)
  }

  engine.on('ready', function () {
    engine.swarm.removeListener('wire', onmagnet)
    if (!argv.all) return
    engine.files.forEach(function (file) {
      file.select()
    })
  })

  var onexit = function () {
    // we're doing some heavy lifting so it can take some time to exit... let's
    // better output a status message so the user knows we're working on it :)
    clivas.line('')
    clivas.line('{yellow:info} {green:peerflix is exiting...}')
  }

  watchVerifying(engine)

  if (argv.remove) {
    var remove = function () {
      onexit()
      engine.remove(function () {
        process.exit()
      })
    }

    process.on('SIGINT', remove)
    process.on('SIGTERM', remove)
  } else {
    process.on('SIGINT', function () {
      onexit()
      process.exit()
    })
  }
}

parsetorrent.remote(filename, function (err, parsedtorrent) {
  if (err) {
    console.error(err.message)
    process.exit(1)
  }
  ontorrent(parsedtorrent)
})
