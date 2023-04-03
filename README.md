# kinostick-peerflix

Streaming torrent client for Node.js

```
npm install -g kinostick-peerflix
```

## Usage

Peerflix can be used with a magnet link or a torrent file.
To stream a video with its magnet link use the following command.

```
kinostick-peerflix "magnet:?xt=urn:btih:ef330b39f4801d25b4245212e75a38634bfc856e" --url /hls/stream/333eeaac-5a53-466d-a7c0-042a62a9491e/
```

kinostick-peerflix
Examples of usage of could be

```
kinostick-peerflix magnet-link --list # Select from a list of files to download
kinostick-peerflix magnet-link --connection 200 # set max connection to 200
```


## Programmatic usage

If you want to build your own app using streaming bittorrent in Node you should checkout [peerflix](https://github.com/mafintosh/peerflix)

 
```
sudo iptables -P INPUT ACCEPT
```

 
