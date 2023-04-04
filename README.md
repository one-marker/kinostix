# kinostix

Streaming torrent client for Node.js

```
npm install -g kinostix
```

## Usage

Peerflix can be used with a magnet link or a torrent file.
To stream a video with its magnet link use the following command.

```
kinostix "magnet:?xt=urn:btih:ef330b39f4801d25b4245212e75a38634bfc856e" --url /hls/stream/333eeaac-5a53-466d-a7c0-042a62a9491e/
```


```
kinostix magnet-link --list # Select from a list of files to download
kinostix magnet-link --connection 200 # set max connection to 200
```


## Programmatic usage

If you want to build your own app using streaming bittorrent in Node you should checkout [peerflix](https://github.com/mafintosh/peerflix)

 
```
sudo iptables -P INPUT ACCEPT
```

 
