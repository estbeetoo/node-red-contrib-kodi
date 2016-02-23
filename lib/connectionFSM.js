~function (undefined) {
    module.exports = function (options) {
        var kodi = require('kodi-ws');
        var machina = require('machina');
        var connectionFSM = new machina.Fsm({
            debug: options.debug ? true : false,
            host: options.host || '127.0.0.1',
            port: options.port || 9090,
            CONNECT_TIMEOUT: options.connectTimeout || options['connect-timeout'] || 2000,
            PING_TIMEOUT: options.pingTimeout || options['ping-timeout'] || 5000,
            PING_INTERVAL: options.pingInterval || options['ping-interval'] || 60000,
            RECONNECT_INTERVAL: options.reconnectInterval || options['reconnect-interval'] || 5000,
            initialize: function (options) {
                this.connected = false;
                this.disconnectingManually = false;
            },
            namespace: "kodi-connection",
            initialState: "uninitialized",
            states: {
                uninitialized: {
                    "*": function () {
                        this.deferUntilTransition();
                        this.transition("connecting");
                    }
                },
                connecting: {
                    _onEnter: function () {
                        this.disconnectingManually = false;
                        this.connected = false;
                        this.emit('connecting');
                        this.debug && console.log('Connecting to: ' + this.host + ':' + this.port);
                        this.connectingTimeout = setTimeout(function () {
                            this.debug && console.log('Connecting timeouted!');
                            this.transition("scheduleReconnect");
                        }.bind(this), this.CONNECT_TIMEOUT);
                        var self = this;
                        kodi(this.host, this.port).then(function (connection) {
                            self.connection = connection;
                            self.debug && console.log('Successfully connected!');
                            self.transition("connected");

                            connection.on('error', function (cause) {
                                self.debug && console.log('Kodi connection event[error], cause: ' + cause);
                                if (!self.disconnectingManually)
                                    self.transition('scheduleReconnect');
                            });
                            connection.on('close', function (cause) {
                                self.debug && console.log('Kodi connection event[close], cause: ' + cause);
                                if (!self.disconnectingManually)
                                    self.handle('scheduleReconnect');
                            });
                            connection.on('end', function (cause) {
                                self.debug && console.log('Kodi connection event[end], cause: ' + cause);
                                if (!self.disconnectingManually)
                                    self.handle('scheduleReconnect');
                            });
                        }, function (err) {
                            self.debug && console.log('Error connecting, cause: ' + error);
                            self.debug && console.log('Schedule reconnecting...');
                            self.handle('scheduleReconnect')
                        });
                    },
                    _onExit: function (connection) {
                        clearTimeout(this.connectingTimeout);
                    }
                },
                scheduleReconnect: {
                    _onEnter: function () {
                        {
                            this.connected = false;
                            this.emit('disconnected');
                            this.connection && this.connection.socket.close();
                            this.connection = null;
                        }
                        this.debug && console.log('Scheduling reconnect');
                        clearTimeout(this.connectingTimeout);
                        this.emit('reconnect');
                        this.reconnectTimer = setTimeout(function () {
                            this.debug && console.log('Reconnecting...');
                            this.transition("connecting");
                        }.bind(this), this.RECONNECT_INTERVAL);
                    },
                    _onExit: function (connection) {
                        clearTimeout(this.reconnectTimer);
                    }
                },
                connected: {
                    _onEnter: function () {
                        if (!this.connected) {
                            this.connected = true;
                            this.emit('connected');
                        }
                        this.debug && console.log('Starting ping interval');
                        this.pingTimer = setTimeout(function () {
                            this.transition("pinging");
                        }.bind(this), this.PING_INTERVAL);
                    },
                    _onExit: function () {
                        clearTimeout(this.pingTimer);
                    }
                },
                pinging: {
                    _onEnter: function () {
                        var self = this;
                        this.pingTimeout = setTimeout(function () {
                            self.debug && console.log('Ping timeout');
                            self.transition('connecting');
                        }.bind(this), this.PING_TIMEOUT);
                        this.connection.JSONRPC.Ping().then(function (pong) {
                            self.debug && console.log('Ping success, pong[' + pong + ']');
                            self.transition('connected');
                        }, function (error) {
                            self.debug && console.log('Ping failed, error[' + error + ']');
                            if (!self.disconnectingManually)
                                self.handle('scheduleReconnect');
                        });
                    },
                    _onExit: function () {
                        clearTimeout(this.pingTimeout);
                    }
                },
                disconnecting: {
                    _onEnter: function () {
                        this.debug && console.log('Disconnecting');
                        this.connected = false;
                        this.disconnectingManually = true;
                        this.emit('disconnected');
                        this.connection && this.connection.socket.close();
                        this.connection = null;
                        this.transition('uninitialized');
                    }
                }
            },
            connect: function () {
                this.handle("_reset");
            },
            disconnect: function () {
                this.transition("disconnecting");
            }
        });
        return connectionFSM;
    }
}();