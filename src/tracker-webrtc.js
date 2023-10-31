// modified from https://github.com/subins2000/p2pt

/**
 * Peer 2 Peer WebRTC connections with WebTorrent Trackers as signalling server
 * Copyright Subin Siby <mail@subinsb.com>, 2020
 * Licensed under MIT
 */

const WebSocketTracker = require('bittorrent-tracker/lib/client/websocket-tracker')
const randombytes = require('randombytes')
const EventEmitter = require('events')
const sha1 = require('simple-sha1')
const debug = require('debug')('p2pt')

export class P2PT extends EventEmitter {
  /**
   *
   * @param array announceURLs List of announce tracker URLs
   * @param string identifierString Identifier used to discover peers in the network
   */
  constructor (announceURLs = [], identifierString = '') {
    super()

    this.announceURLs = announceURLs
    this.trackers = {}
    this.peers = {}

    if (identifierString) { this.setIdentifier(identifierString) }

    this._peerIdBuffer = randombytes(20)
    this._peerId = this._peerIdBuffer.toString('hex')
    this._peerIdBinary = this._peerIdBuffer.toString('binary')

    debug('my peer id: ' + this._peerId)
  }

  /**
   * Set the identifier string used to discover peers in the network
   * @param string identifierString
   */
  setIdentifier (identifierString) {
    this.identifierString = identifierString
    this.infoHash = sha1.sync(identifierString).toLowerCase()
    this._infoHashBuffer = Buffer.from(this.infoHash, 'hex')
    this._infoHashBinary = this._infoHashBuffer.toString('binary')
  }

  /**
   * Connect to network and start discovering peers
   */
  start () {
    // emitted by the tracker when it gets a new announce response from the server
    this.on('peer', peer => {
      let isNewPeer = false
      if (!this.peers[peer.id]) {
        isNewPeer = true
        this.peers[peer.id] = {}
      }

      peer.on('connect', () => {
        /**
         * Multiple data channels to one peer is possible
         * The `peer` object actually refers to a peer with a data channel. Even though it may have same `id` (peerID) property, the data channel will be different. Different trackers giving the same "peer" will give the `peer` object with different channels.
         * We will store all channels as backups in case any one of them fails
         * A peer is removed if all data channels become unavailable
         */
        this.peers[peer.id][peer.channelName] = peer

        if (isNewPeer) {
          this.emit('peerconnect', peer)
        }
      })

      peer.on('error', err => {
        this._removePeer(peer)
        debug('Error in connection : ' + err)
      })

      peer.on('close', () => {
        this._removePeer(peer)
        debug('Connection closed with ' + peer.id)
      })
    })

    // Tracker responded to the announce request
    this.on('update', response => {
      const tracker = this.trackers[this.announceURLs.indexOf(response.announce)]

      this.emit(
        'trackerconnect',
        tracker,
        this.getTrackerStats()
      )
    })

    // Errors in tracker connection
    this.on('warning', err => {
      this.emit(
        'trackerwarning',
        err,
        this.getTrackerStats()
      )
    })

    this._fetchPeers()
  }

  /**
   * Add a tracker
   * @param string announceURL Tracker Announce URL
   */
  addTracker (announceURL) {
    if (this.announceURLs.indexOf(announceURL) !== -1) {
      throw new Error('Tracker already added')
    }

    const key = this.announceURLs.push(announceURL)

    this.trackers[key] = new WebSocketTracker(this, announceURL)
    this.trackers[key].announce(this._defaultAnnounceOpts())
  }

  /**
   * Remove a tracker without destroying peers
   */
  removeTracker (announceURL) {
    const key = this.announceURLs.indexOf(announceURL)

    if (key === -1) {
      throw new Error('Tracker does not exist')
    }

    // hack to not destroy peers
    this.trackers[key].peers = []
    this.trackers[key].destroy()

    delete this.trackers[key]
    delete this.announceURLs[key]
  }

  /**
   * Remove a peer from the list if all channels are closed
   * @param integer id Peer ID
   */
  _removePeer (peer) {
    if (!this.peers[peer.id]) { return false }

    delete this.peers[peer.id][peer.channelName]

    // All data channels are gone. Peer lost
    if (Object.keys(this.peers[peer.id]).length === 0) {
      this.emit('peerclose', peer)
      delete this.peers[peer.id]
    }
  }

  /**
   * Request more peers
   */
  requestMorePeers () {
    return new Promise(resolve => {
      for (const key in this.trackers) {
        this.trackers[key].announce(this._defaultAnnounceOpts())
      }
      resolve(this.peers)
    })
  }

  /**
   * Get basic stats about tracker connections
   */
  getTrackerStats () {
    let connectedCount = 0
    for (const key in this.trackers) {
      if (this.trackers[key].socket && this.trackers[key].socket.connected) {
        connectedCount++
      }
    }

    return {
      connected: connectedCount,
      total: this.announceURLs.length
    }
  }

  /**
   * Destroy object
   */
  destroy () {
    let key
    for (key in this.peers) {
      for (const key2 in this.peers[key]) {
        this.peers[key][key2].destroy()
      }
    }
    for (key in this.trackers) {
      this.trackers[key].destroy()
    }
  }

  /**
   * A custom function binded on Peer object to easily respond back to message
   * @param Peer peer Peer to send msg to
   * @param integer msgID Message ID
   */
  _peerRespond (peer, msgID) {
    return msg => {
      return this.send(peer, msg, msgID)
    }
  }

  /**
   * Handle msg chunks. Returns false until the last chunk is received. Finally returns the entire msg
   * @param object data
   */
  _chunkHandler (data) {
    if (!this.msgChunks[data.id]) {
      this.msgChunks[data.id] = []
    }

    this.msgChunks[data.id][data.c] = data.msg

    if (data.last) {
      const completeMsg = this.msgChunks[data.id].join('')
      return completeMsg
    } else {
      return false
    }
  }

  /**
   * Remove all stored chunks of a particular message
   * @param integer msgID Message ID
   */
  _destroyChunks (msgID) {
    delete this.msgChunks[msgID]
  }

  /**
   * Default announce options
   * @param object opts Options
   */
  _defaultAnnounceOpts (opts = {}) {
    if (opts.numwant == null) opts.numwant = 50

    if (opts.uploaded == null) opts.uploaded = 0
    if (opts.downloaded == null) opts.downloaded = 0

    return opts
  }

  /**
   * Initialize trackers and fetch peers
   */
  _fetchPeers () {
    for (const key in this.announceURLs) {
      this.trackers[key] = new WebSocketTracker(this, this.announceURLs[key])
      this.trackers[key].announce(this._defaultAnnounceOpts())
    }
  }
}
