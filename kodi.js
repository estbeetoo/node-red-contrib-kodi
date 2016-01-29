/**
 * Created by aborovsky on 27.08.2015.
 */

var util = require('util');
var DEBUG = false;
var connectionFSM = require('./lib/connectionFSM.js');

module.exports = function (RED) {

    /**
     * ====== Globalcache-controller ================
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
                RED.comms.publish("debug", {
                    name: node.name,
                    msg: 'already configured connection to Kodi player at ' + config.host + ':' + config.port
                });
                if (handler && (typeof handler === 'function'))
                    handler(node.kodi);
                return node.kodi;
            }
            node.log('configuring connection to Kodi player at ' + config.host + ':' + config.port);

            node.kodi = new connectionFSM({
                host: config.host,
                port: config.port,
                debug: DEBUG
            });

            connection.connect();

            RED.comms.publish("debug", {
                name: node.name,
                msg: 'Kodi: successfully connected to ' + config.host + ':' + config.port
            });
            if (handler && (typeof handler === 'function'))
                handler(node.kodi);
            return node.kodi;
        };
        this.on("close", function () {
            node.log('disconnecting from kodijs server at ' + config.host + ':' + config.port);
            node.kodi && node.kodi.disconnect && node.kodi.disconnect();
        });
    }

    RED.nodes.registerType("kodi-controller", KodiControllerNode);

    /**
     * ====== Globalcache-out =======================
     * Sends outgoing Kodi player from
     * messages received via node-red flows
     * =======================================
     */
    function KodiOut(config) {
        RED.nodes.createNode(this, config);
        this.name = config.name;
        this.ctrl = RED.nodes.getNode(config.controller);
        this.unit_number = config.unit_number;
        this.output = config.output;
        this.kodicommand = config.kodicommand;
        var node = this;
        //node.log('new Globalcache-out, config: ' + util.inspect(config));
        //
        this.on("input", function (msg) {
            RED.comms.publish("debug", {name: node.name, msg: 'kodiout.onInput msg[' + util.inspect(msg) + ']'});
            //node.log('kodiout.onInput msg[' + util.inspect(msg) + ']');
            if (!(msg && msg.hasOwnProperty('payload'))) return;
            var payload = msg.payload;
            if (typeof(msg.payload) === "object") {
                payload = msg.payload;
            } else if (typeof(msg.payload) === "string") {
                try {
                    payload = JSON.parse(msg.payload);
                } catch (e) {
                    payload = msg.payload.toString();
                }
            }
            if (payload == null) {
                node.log('kodiout.onInput: illegal msg.payload!');
                return;
            }

            if (node.output != null && node.kodicommand && node.kodicommand !== 'empty') {
                if (msg.hasOwnProperty('format') && typeof(msg.format) === 'string' && (msg.format.toLowerCase() === 'ccf' || msg.format.toLowerCase() === 'hex') && typeof(payload) === 'string') {
                    payload = helper.CCFtoKodi(payload, node.kodicommand.toString(), ((parseInt(node.unit_number) === 0 || isNaN(parseInt(node.unit_number))) ? '1' : node.unit_number.toString()), node.output, 1);
                }
                else if (typeof(payload) === 'string')
                    payload = node.kodicommand.toString() + ',' + ((parseInt(node.unit_number) === 0 || isNaN(parseInt(node.unit_number))) ? '1' : node.unit_number.toString()) + ':' + node.output + ',' + payload;
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

        function nodeStatusConnecting() {
            node.status({fill: "green", shape: "ring", text: "connecting"});
        }

        this.send = function (data, callback) {
            RED.comms.publish("debug", {name: node.name, msg: 'send data[' + data + ']'});
            //node.log('send data[' + data + ']');
            // init a new one-off connection from the effectively singleton KodiController
            // there seems to be no way to reuse the outgoing conn in adreek/node-kodijs
            this.ctrl.initializeKodiConnection(function (connection) {
                if (connection.connected)
                    nodeStatusConnected();
                else
                    nodeStatusDisconnected();
                connection.removeListener('connecting', nodeStatusConnecting);
                connection.on('connecting', nodeStatusConnecting);
                connection.removeListener('connected', nodeStatusConnected);
                connection.on('connected', nodeStatusConnected);
                connection.removeListener('disconnected', nodeStatusDisconnected);
                connection.on('disconnected', nodeStatusDisconnected);

                try {
                    RED.comms.publish("debug", {name: node.name, msg: "send:  " + JSON.stringify(data)});
                    connection.send(data, function (err) {
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
        var kodijsController = RED.nodes.getNode(config.controller);
        /* ===== Node-Red events ===== */
        this.on("input", function (msg) {
            if (msg != null) {

            }
        });
        this.on("close", function () {
            if (node.receiveEvent && node.connection)
                node.connection.removeListener('event', node.receiveEvent);
            if (node.receiveStatus && node.connection)
                node.connection.removeListener('status', node.receiveStatus);
        });

        function nodeStatusConnecting() {
            node.status({fill: "green", shape: "ring", text: "connecting"});
        }

        function nodeStatusConnected() {
            node.status({fill: "green", shape: "dot", text: "connected"});
        }

        function nodeStatusDisconnected() {
            node.status({fill: "red", shape: "dot", text: "disconnected"});
        }

        node.receiveData = function (data) {
            RED.comms.publish("debug", {name: node.name, msg: 'kodi event data[' + data.toString('hex') + ']'});
            node.send({
                topic: 'kodi',
                payload: {
                    'data': data.toString()
                }
            });
        };

//		this.on("error", function(msg) {});

        /* ===== kodijs events ===== */
        kodijsController.initializeKodiConnection(function (connection) {
            node.connection = connection;
            node.connection.removeListener('event', node.receiveData);
            node.connection.on('data', node.receiveData);

            if (node.connection.connected)
                nodeStatusConnected();
            else
                nodeStatusDisconnected();
            node.connection.removeListener('connecting', nodeStatusConnecting);
            node.connection.on('connecting', nodeStatusConnecting);
            node.connection.removeListener('connected', nodeStatusConnected);
            node.connection.on('connected', nodeStatusConnected);
            node.connection.removeListener('disconnected', nodeStatusDisconnected);
            node.connection.on('disconnected', nodeStatusDisconnected);
        });
    }

    RED.nodes.registerType("kodi-in", KodiIn);
}
