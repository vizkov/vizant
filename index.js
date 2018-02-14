var SIGNALING_SERVER = "http://vizant-tivo.rhcloud.com";
var USE_AUDIO = true;
var USE_VIDEO = true;
var DEFAULT_CHANNEL = '';
var MUTE_AUDIO_BY_DEFAULT = false;
var ICE_SERVERS = [{
    url: "stun:stun.l.google.com:19302"
        }];
var signaling_socket = null;
var local_media_stream = null;
var peers = {};
var peer_media_elements = {};


function clear_index() {
    var room = document.getElementById('room');
    var call = document.getElementById('call');

    room.remove();
    call.remove();
}

function call() {
    var value = document.getElementById('room').value;
    if (value != '') {
        DEFAULT_CHANNEL = value;
        clear_index();
        init();

    }
}

function init() {
    console.log("Connecting to signaling server");
    signaling_socket = io(SIGNALING_SERVER);
    signaling_socket = io();

    signaling_socket.on('connect', function () {
        console.log("Connected to signaling server");
        setup_local_media(function () {
            join_chat_channel(DEFAULT_CHANNEL, {
                'whatever-you-want-here': 'stuff'
            });
        });
    });
    signaling_socket.on('disconnect', function () {
        console.log("Disconnected from signaling server");

        for (peer_id in peer_media_elements) {
            peer_media_elements[peer_id].remove();
        }
        for (peer_id in peers) {
            peers[peer_id].close();
        }

        peers = {};
        peer_media_elements = {};
    });

    function join_chat_channel(channel, userdata) {
        signaling_socket.emit('join', {
            "channel": channel,
            "userdata": userdata
        });
    }

    function part_chat_channel(channel) {
        signaling_socket.emit('part', channel);
    }


    signaling_socket.on('addPeer', function (config) {
        console.log('Signaling server said to add peer:', config);
        var peer_id = config.peer_id;
        if (peer_id in peers) {
            console.log("Already connected to peer ", peer_id);
            return;
        }
        var peer_connection = new RTCPeerConnection({
            "iceServers": ICE_SERVERS
        }, {
            "optional": [{
                "DtlsSrtpKeyAgreement": true
                        }]
        });
        peers[peer_id] = peer_connection;

        peer_connection.onicecandidate = function (event) {
            if (event.candidate) {
                signaling_socket.emit('relayICECandidate', {
                    'peer_id': peer_id,
                    'ice_candidate': {
                        'sdpMLineIndex': event.candidate.sdpMLineIndex,
                        'candidate': event.candidate.candidate
                    }
                });
            }
        }
        peer_connection.onaddstream = function (event) {
            console.log("onAddStream", event);
            var remote_media = USE_VIDEO ? $("<video>") : $("<audio>");
            remote_media.attr("autoplay", "autoplay");
            if (MUTE_AUDIO_BY_DEFAULT) {
                remote_media.attr("muted", "true");
            }
            remote_media.attr("controls", "");
            peer_media_elements[peer_id] = remote_media;
            $('body').append(remote_media);
            attachMediaStream(remote_media[0], event.stream);
        }

        peer_connection.addStream(local_media_stream);

        if (config.should_create_offer) {
            console.log("Creating RTC offer to ", peer_id);
            peer_connection.createOffer(
                function (local_description) {
                    console.log("Local offer description is: ", local_description);
                    peer_connection.setLocalDescription(local_description,
                        function () {
                            signaling_socket.emit('relaySessionDescription', {
                                'peer_id': peer_id,
                                'session_description': local_description
                            });
                            console.log("Offer setLocalDescription succeeded");
                        },
                        function () {
                            Alert("Offer setLocalDescription failed!");
                        }
                    );
                },
                function (error) {
                    console.log("Error sending offer: ", error);
                });
        }
    });


    signaling_socket.on('sessionDescription', function (config) {
        console.log('Remote description received: ', config);
        var peer_id = config.peer_id;
        var peer = peers[peer_id];
        var remote_description = config.session_description;
        console.log(config.session_description);

        var desc = new RTCSessionDescription(remote_description);
        var stuff = peer.setRemoteDescription(desc,
            function () {
                console.log("setRemoteDescription succeeded");
                if (remote_description.type == "offer") {
                    console.log("Creating answer");
                    peer.createAnswer(
                        function (local_description) {
                            console.log("Answer description is: ", local_description);
                            peer.setLocalDescription(local_description,
                                function () {
                                    signaling_socket.emit('relaySessionDescription', {
                                        'peer_id': peer_id,
                                        'session_description': local_description
                                    });
                                    console.log("Answer setLocalDescription succeeded");
                                },
                                function () {
                                    Alert("Answer setLocalDescription failed!");
                                }
                            );
                        },
                        function (error) {
                            console.log("Error creating answer: ", error);
                            console.log(peer);
                        });
                }
            },
            function (error) {
                console.log("setRemoteDescription error: ", error);
            }
        );
        console.log("Description Object: ", desc);

    });


    signaling_socket.on('iceCandidate', function (config) {
        var peer = peers[config.peer_id];
        var ice_candidate = config.ice_candidate;
        peer.addIceCandidate(new RTCIceCandidate(ice_candidate));
    });

    signaling_socket.on('removePeer', function (config) {
        console.log('Signaling server said to remove peer:', config);
        var peer_id = config.peer_id;
        if (peer_id in peer_media_elements) {
            peer_media_elements[peer_id].remove();
        }
        if (peer_id in peers) {
            peers[peer_id].close();
        }

        delete peers[peer_id];
        delete peer_media_elements[config.peer_id];
    });
}

function setup_local_media(callback, errorback) {
    if (local_media_stream != null) {
        if (callback) callback();
        return;
    }

    console.log("Requesting access to local audio / video inputs");


    navigator.getUserMedia = (navigator.getUserMedia ||
        navigator.webkitGetUserMedia ||
        navigator.mozGetUserMedia ||
        navigator.msGetUserMedia);

    attachMediaStream = function (element, stream) {
        console.log('DEPRECATED, attachMediaStream will soon be removed.');
        element.srcObject = stream;
    };

    navigator.getUserMedia({
            "audio": USE_AUDIO,
            "video": USE_VIDEO
        },
        function (stream) {
            console.log("Access granted to audio/video");
            local_media_stream = stream;
            var local_media = USE_VIDEO ? $("<video>") : $("<audio>");
            local_media.attr("autoplay", "autoplay");
            local_media.attr("muted", "true");
            local_media.attr("controls", "");
            $('body').append(local_media);
            attachMediaStream(local_media[0], stream);

            if (callback) callback();
        },
        function () {
            console.log("Access denied for audio/video");
            alert("You chose not to provide access to the camera/microphone, demo will not work.");
            if (errorback) errorback();
        });
}
