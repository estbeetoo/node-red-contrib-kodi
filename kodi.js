/**
 * Created by aborovsky on 27.08.2015.
 */

var util = require('util');
var DEBUG = false;
var connectionFSM = require('./lib/connectionFSM.js');

module.exports = function (RED) {

    /**
     * ====== Kodi-controller ================
     * Holds configuration for kodijs host+port,
     * initializes new kodijs connections
     * =======================================
     */
    function KodiControllerNode(config) {
        RED.nodes.createNode(this, config);
        this.name = config.name;
        this.host = config.host;
        this.port = config.port;
        this.kodi = null;
        var node = this;

        /**
         * Initialize an kodijs socket, calling the handler function
         * when successfully connected, passing it the kodijs connection
         */
        this.initializeKodiConnection = function (handler) {
            if (node.kodi) {
                DEBUG && RED.comms.publish("debug", {
                    name: node.name,
                    msg: 'already configured connection to Kodi player at ' + config.host + ':' + config.port
                });
                if (handler && (typeof handler === 'function')) {
                    if (node.kodi.connection)
                        handler(node.kodi);
                    else
                        node.kodi.on('connected', function () {
                            handler(node.kodi);
                        });
                }
                return node.kodi;
            }
            node.log('configuring connection to Kodi player at ' + config.host + ':' + config.port);
            node.kodi = new connectionFSM({
                host: config.host,
                port: config.port,
                debug: DEBUG
            });
            if (handler && (typeof handler === 'function')) {
                node.kodi.on('connected', function () {
                    handler(node.kodi);
                });
            }
            node.kodi.connect();
            DEBUG && RED.comms.publish("debug", {
                name: node.name,
                msg: 'Kodi: successfully connected to ' + config.host + ':' + config.port
            });

            return node.kodi;
        };
        this.on("close", function () {
            node.log('disconnecting from kodijs server at ' + config.host + ':' + config.port);
            node.kodi && node.kodi.disconnect && node.kodi.disconnect();
            node.kodi = null;
        });
    }

    RED.nodes.registerType("kodi-controller", KodiControllerNode);

    /**
     * ====== Kodi-out =======================
     * Sends outgoing Kodi player from
     * messages received via node-red flows
     * =======================================
     */
    function KodiOut(config) {
        RED.nodes.createNode(this, config);
        this.name = config.name;
        var controllerNode = RED.nodes.getNode(config.controller);
        this.unit_number = config.unit_number;
        this.kodicommand = config.kodicommand;
        var node = this;
        //node.log('new Kodi-out, config: ' + util.inspect(config));
        //
        this.on("input", function (msg) {
            DEBUG && RED.comms.publish("debug", {
                name: node.name,
                msg: 'kodiout.onInput msg[' + util.inspect(msg) + ']'
            });
            //node.log('kodiout.onInput msg[' + util.inspect(msg) + ']');
            if (!(msg && msg.hasOwnProperty('payload'))) return;
            var payload = msg.payload;
            if (typeof(msg.payload) === "object") {
                payload = msg.payload;
            } else if (typeof(msg.payload) === "string") {
                try {
                    payload = JSON.parse(msg.payload);
                    if (typeof (payload) === 'number')
                        payload = {cmd: msg.payload.toString()};
                } catch (e) {
                    payload = {cmd: msg.payload.toString()};
                }
            }
            if (payload == null) {
                node.log('kodiout.onInput: illegal msg.payload!');
                return;
            }

            if (node.kodicommand && node.kodicommand !== 'empty') {
                try {
                    payload = JSON.parse(node.kodicommand);
                    if (typeof (payload) === 'number')
                        payload = {cmd: node.kodicommand.toString()};
                } catch (e) {
                    payload = {cmd: node.kodicommand.toString()};
                }
            }

            node.send(payload, function (err) {
                if (err) {
                    node.error('send error: ' + err);
                }
                if (typeof(msg.cb) === 'function')
                    msg.cb(err);
            });

        });
        this.on("close", function () {
            node.log('kodiOut.close');
        });

        node.status({fill: "yellow", shape: "dot", text: "inactive"});

        function nodeStatusConnected() {
            node.status({fill: "green", shape: "dot", text: "connected"});
        }

        function nodeStatusDisconnected() {
            node.status({fill: "red", shape: "dot", text: "disconnected"});
        }

        function nodeStatusReconnect() {
            node.status({fill: "yellow", shape: "ring", text: "reconnecting"});
        }

        function nodeStatusConnecting() {
            node.status({fill: "green", shape: "ring", text: "connecting"});
        }

        controllerNode.initializeKodiConnection(function (fsm) {
            if (fsm.connected)
                nodeStatusConnected();
            else
                nodeStatusDisconnected();
            fsm.off('connecting', nodeStatusConnecting);
            fsm.on('connecting', nodeStatusConnecting);
            fsm.off('connected', nodeStatusConnected);
            fsm.on('connected', nodeStatusConnected);
            fsm.off('disconnected', nodeStatusDisconnected);
            fsm.on('disconnected', nodeStatusDisconnected);
            fsm.off('reconnect', nodeStatusReconnect);
            fsm.on('reconnect', nodeStatusReconnect);
        });

        this.send = function (data, callback) {
            DEBUG && RED.comms.publish("debug", {name: node.name, msg: 'send data[' + JSON.stringify(data) + ']'});
            //node.log('send data[' + data + ']');
            // init a new one-off connection from the effectively singleton KodiController
            // there seems to be no way to reuse the outgoing conn in adreek/node-kodijs
            controllerNode.initializeKodiConnection(function (fsm) {
                try {
                    DEBUG && RED.comms.publish("debug", {name: node.name, msg: "send:  " + JSON.stringify(data)});
                    data.cmd = data.cmd || data.method;
                    data.args = data.args || data.params;
                    fsm.connection.run(data.cmd, data.args).then(function () {
                        callback && callback();
                    }, function (err) {
                        callback && callback(err);
                    });
                }
                catch (err) {
                    node.error('error calling send: ' + err);
                    callback(err);
                }
            });
        }
    }

    //
    RED.nodes.registerType("kodi-out", KodiOut);

    /**
     * ====== Kodi-IN ========================
     * Handles incoming Global Cache, injecting
     * json into node-red flows
     * =======================================
     */
    function KodiIn(config) {
        RED.nodes.createNode(this, config);
        this.name = config.name;
        this.connection = null;
        var node = this;
        //node.log('new KodiIn, config: %j', config);
        var controllerNode = RED.nodes.getNode(config.controller);

        /* ===== Node-Red events ===== */
        function nodeStatusConnecting() {
            node.status({fill: "green", shape: "ring", text: "connecting"});
        }

        function nodeStatusConnected() {
            node.status({fill: "green", shape: "dot", text: "connected"});
        }

        function nodeStatusDisconnected() {
            node.status({fill: "red", shape: "dot", text: "disconnected"});
        }

        function nodeStatusReconnect() {
            node.status({fill: "yellow", shape: "ring", text: "reconnecting"});
        }

        function bindNotificationListeners(connection) {
            function getListenerForNotification(notification) {
                return function (data) {
                    node.receiveNotification(notification, data);
                }
            }

            Object.keys(connection.schema.schema.notifications).forEach(function (method) {
                connection.schema.schema.notifications[method](getListenerForNotification(method));
            });
        }

        node.receiveNotification = function (notification, data) {
            DEBUG && RED.comms.publish("debug", {
                name: node.name,
                msg: 'kodi event data[' + JSON.stringify(data) + ']'
            });
            node.send({
                topic: 'kodi',
                payload: {
                    'notification': notification,
                    'data': data
                }
            });
        };

        controllerNode.initializeKodiConnection(function (fsm) {
            bindNotificationListeners(fsm.connection);

            if (fsm.connected)
                nodeStatusConnected();
            else
                nodeStatusDisconnected();
            fsm.off('connecting', nodeStatusConnecting);
            fsm.on('connecting', nodeStatusConnecting);
            fsm.off('connected', nodeStatusConnected);
            fsm.on('connected', nodeStatusConnected);
            fsm.off('disconnected', nodeStatusDisconnected);
            fsm.on('disconnected', nodeStatusDisconnected);
            fsm.off('reconnect', nodeStatusReconnect);
            fsm.on('reconnect', nodeStatusReconnect);
        });
    }

    RED.nodes.registerType("kodi-in", KodiIn);
}