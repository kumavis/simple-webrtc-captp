import './env.js'
import { P2PT } from "./tracker-webrtc.js";

// multiplex

// see https://github.com/ngosang/trackerslist/blob/master/trackers_all_ws.txt
const webtorrentTrackers = [
  "wss://tracker.openwebtorrent.com",
  "wss://tracker.files.fm:7073/announce",
  "wss://tracker.webtorrent.dev",
  // "wss://tracker.sloppyta.co",
  // "wss://tracker.novage.com.ua",
  // "wss://tracker.btorrent.xyz",
  // "wss://tracker.vaportrade.net",
];

const p2pt = new P2PT(webtorrentTrackers, "simple-webrtc-captp");

const log = console.log

// If a new peer, send message. peer is duplex stream
p2pt.on('peerconnect', (peer) => {
  log('New Peer ! : ' + peer.id + '.')
})


export const start = async () => {
  log('P2PT started. My peer id : ' + p2pt._peerId)
  return p2pt.start();
}

globalThis.p2pt = p2pt
console.log('p2pt', p2pt)