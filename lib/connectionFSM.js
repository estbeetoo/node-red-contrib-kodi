~function (undefined) {
    module.exports = function (options) {
        var kodi = require('kodi-ws');
        var machina = require('machina');
        var connectionFSM = new machina.Fsm({
            debug: options.debug ? true : false,
            host: options.host || '127.0.0.1',
            port: options.port || 9090,
            CONNECT_TIMEOUT: options.connectTimeout || options['connect-timeout'] || 2000,
            PING_TIMEOUT: options.pingTimeout || options['ping-timeout'] || 2000,
            PING_INTERVAL: options.pingInterval || options['ping-interval'] || 5000,
            RECONNECT_INTERVAL: options.reconnectInterval || options['reconnect-interval'] || 5000,
            // the initialize method is called right after the FSM
            // instance is constructed, giving you a place for any
            // setup behavior, etc. It receives the same arguments
            // (options) as the constructor function.
            initialize: function (options) {
                this.connectionStatus = false;
            },
            namespace: "kodi-connection",

            // `initialState` tells machina what state to start the FSM in.
            // The default value is "uninitialized". Not providing
            // this value will throw an exception in v1.0+
            initialState: "uninitialized",

            // The states object's top level properties are the
            // states in which the FSM can exist. Each state object
            // contains input handlers for the different inputs
            // handled while in that state.
            states: {
                uninitialized: {
                    // Input handlers are usually functions. They can
                    // take arguments, too (even though this one doesn't)
                    // The "*" handler is special (more on that in a bit)
                    "*": function () {
                        this.deferUntilTransition();
                        // the `transition` method takes a target state (as a string)
                        // and transitions to it. You should NEVER directly assign the
                        // state property on an FSM. Also - while it's certainly OK to
                        // call `transition` externally, you usually end up with the
                        // cleanest approach if you endeavor to transition *internally*
                        // and just pass input to the FSM.
                        this.transition("connecting");
                    }
                },
                connecting: {
                    _onEnter: function () {
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
                                self.transition('scheduleReconnect');
                            });
                            connection.on('close', function (cause) {
                                self.debug && console.log('Kodi connection event[close], cause: ' + cause);
                                self.handle('scheduleReconnect');
                            });
                            connection.on('end', function (cause) {
                                self.debug && console.log('Kodi connection event[end], cause: ' + cause);
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
                            this.connection && this.connection.close();
                            this.connection = null;
                        }
                        this.debug && console.log('Scheduling reconnect');
                        clearTimeout(this.connectingTimeout);
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
                            self.transition('connecting');
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
                        this.emit('disconnected');
                        this.connection && this.connection.close();
                        this.connection = null;
                        this.transition('uninitialized');
                    }
                }
            },

            // While you can call the FSM's `handle` method externally, it doesn't
            // make for a terribly expressive API. As a general rule, you wrap calls
            // to `handle` with more semantically meaningful method calls like these:
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

