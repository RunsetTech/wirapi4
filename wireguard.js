const execSync = require('child_process').execSync
const Peer = require('./mongoose').Peer
const User = require('./mongoose').User
const Server = require('./mongoose').Server
const IP = require('./mongoose').IP
const Counter = require('./mongoose').Counter
const {
    GraphQLError
} = require('graphql')

// initialize the WireGuard CLI according to the database
async function initialize() {
    // clear WireGuard CLI configurations, your wg0.conf should only contain the interface and no peers (unless you have default ones for access control)
    execSync('systemctl restart wg-quick@wg0')


    Server.findOne({ serverSettings: true }).then(server => {
        if(server == null || server == undefined) {
            let server = new Server()
            let serverJsonString = execSync('bash /home/ubuntu/wirapi2/json.sh').toString()
            // console.log(serverJsonString)
            let serverJson = JSON.parse(serverJsonString).peers[0]
            server.serverSettings = true;
            server.publicKey = serverJson.publicKey
            server.endpoint = serverJson.endpoint
            server.download = "0"
            server.upload = "0"
            server.timeUsed = "0"
            server.save()
        }
    })
  

    // load peers in the database into CLI (if it is enabled)
    return Peer.find({ enabled: true })
        .then(peers => {
            peers.forEach(peer => {
                execSync('wg set wg0 peer ' + peer.publicKey + ' allowed-ips ' + peer.allowedIP + '/32')
            })
        })
}

var checkingIp = false;
// add a peer in WireGuard CLI and updates the database
async function addPeer(data) {
   
    //    checkingIp = true;
        
    // function to generate a valid peer IP in sequence in the database
    async function getAllowedIP() {
        // function IPtoInt(IP) {
        //     return (IP.split('.')[2] * 200) + (IP.split('.')[3] - 10)
        // }

        // function intToIP(count) {
        //     return process.env.LOCAL_IP_RANGE + Math.floor(count / 200).toString() + '.' + ((count % 200) + 10).toString()
        // }

        function incrementIp(input) {
            // console.log(input);
            tokens = input.split(".");
            if (tokens.length != 4)
                throw console.log('ip invalid');
            for (var i = tokens.length - 1; i >= 0; i--) {
                item = parseInt(tokens[i]);
                if (item < 200) {
                    tokens[i] =item + 1;
                    for (var j = i + 1; j < 4; j++) {
                        tokens[j] = "0";
                    }
                    break;
                }
            }
            return (tokens[0] + '.' + tokens[1] + '.' + tokens[2] + '.' + tokens[3])
        }
        

        // let documents = await Peer.find().exec()
        // let IPs = []

        // loop through all peers and extract allowedIP into IPs

        
        
        var ips = await IP.find().exec()


       

        if(ips.length == 0) {
            var chosenIp =  '10.0.0.10';
            var dbIp = new IP({ipAddress:chosenIp});
            await dbIp.save()
           
            return chosenIp;
        } else {
            ipsArray = [];
            ips.forEach(ip => {
                ipsArray.push(ip.ipAddress);
            });

            ipsArray.sort((a, b) => {
                const num1 = Number(a.split(".").map((num) => (`000${num}`).slice(-3) ).join(""));
                const num2 = Number(b.split(".").map((num) => (`000${num}`).slice(-3) ).join(""));
                return num1-num2;
            });

            var chosenIp = incrementIp(ipsArray[(ipsArray.length - 1)]);
            var dbIp = new IP({ipAddress:chosenIp});
            await dbIp.save()
            
            return chosenIp;
        }
        
        // console.log('unsorted IPS array : ');
        // console.log(IPs);
        // // sort the IPs array
        // IPs.sort(function(a, b) {
        //     return a - b;
        //   });
          

        // console.log('sorted IPS array : ');
        // console.log(IPs);

        // // check if there are any gaps in IP assignment
        // for (i in IPs) {
        //     // if so, return the gap IP. At the end of the array, it will compare to undefined, which will return true, and trigger it to return the next available IP.
        //     if (IPs[i] + 1 !== IPs[parseInt(i) + 1]) {
        //         return intToIP(IPs[i] + 1)
        //     }
        // }
        // // In case it's empty (undefined === undefined is true), return the next available IP, which is 0
        // return intToIP(0)
    }

    // check if the new peer has a user attribute
    if (data.user) {
        const user = await User.findOne({ name: data.user }).exec()

        // check if the user is in the database
        if (user) {
            // check if the user has reached their peer limit
            if (await Peer.countDocuments({ user: user.name }) >= user.peerLimit) {
                throw new GraphQLError('User peer limit reached')
            }
        }
    }

    function int2ip (ipInt) {
        return (  '10.' + (ipInt>>16 & 255) +'.' + (ipInt>>8 & 255) +'.' + (ipInt & 255) );
    }

    var counter = await Counter.findOneAndUpdate({origin:'ip-counter'},{$inc : {'counter' : 1}}).exec();

    // var ipAddress = await getAllowedIP();

    var ipAddress = int2ip(counter);

    // add a peer in CLI and save to database
    let peer = new Peer(JSON.parse(execSync('bash /home/ubuntu/wirapi2/add.sh ' + ipAddress).toString()))

    // default enabled to true if it's not provided
    peer.enabled = data.enabled === undefined ? true : data.enabled

    // assign other optional attributes
    peer.user = data.user
    peer.device = data.device
    peer.description = data.description
    peer.dataLimit = data.dataLimit
    peer.timeLimit = data.timeLimit
    peer.lastDownload = "0"
    peer.lastUpload = "0"

    // write to database
    peer = await peer.save()

    // check if peer is disabled by default
    if (!peer.enabled) {
        // if so, disable the peer
        blockPeers({ publicKey: peer.publicKey })
    }

    checkingIp = false;
    // return the peer object
    return peer

}

// updates a peer's attributes
async function updatePeers(filter, data) {
    // look up the peer in the database
    let peers = await Peer.find(filter).exec()

    // check if the peers exist
    if (!peers.length) {
        return []
    }

    peers.forEach(peer => {
        // if undefined, do not write; if null, delete data by setting undefined; else, write new data
        if (data.user !== undefined) {
            peer.user = data.user === null ? undefined : data.user
        }
        if (data.description !== undefined) {
            peer.description = data.description === null ? undefined : data.description
        }
        if (data.dataLimit !== undefined) {
            peer.dataLimit = data.dataLimit === null ? undefined : data.dataLimit
        }
        if (data.timeLimit !== undefined) {
            peer.timeLimit = data.timeLimit === null ? undefined : data.timeLimit
        }
        if (data.enabled !== undefined) {
            if (data.enabled) {
                unblockPeers({ publicKey: peer.publicKey })
            } else {
                blockPeers({ publicKey: peer.publicKey })
            }
        }

        // write changes to database
        peer.save()
    })

    return peers
}

// clears a peer's usage attributes
async function clearPeers(filter) {
    // look up the peer in the database
    let peers = await Peer.find(filter).exec()

    // check if the peers exist
    if (!peers.length) {
        return []
    }

    peers.forEach(peer => {
        // reset the peer's usage attributes
        peer.upload = '0'
        peer.download = '0'
        peer.timeUsed = '0'

        // reenable the peer
        unblockPeers({ publicKey: peer.publicKey })

        // write changes to database
        peer.save()
    })

    return peers
}

// removes peers in WireGuard CLI and the database 
async function removePeers(filter) {
    // look up peers in database
    let peers = await Peer.find(filter).exec()

    // check if the peers exist
    if (!peers.length) {
        return []
    }

    // remove each of the peer from the database and the CLI
    peers.forEach(peer => {
        execSync('wg set wg0 peer ' + peer.publicKey + ' remove')
        peer.remove()
    })

    return peers
}

// add a user to the database
async function addUser(data) {
    // check if the database already have a overlapping username
    if (await User.findOne({ name: data.name })) {
        throw new GraphQLError('User with the same name already exists.')
    }

    // create new user object
    let user = new User(data)

    // save new user to database
    user.save()

    return user
}

// update users' attributes
async function updateUsers(filter, data) {
    // look up users in database
    let users = await User.find(filter).exec()

    // check if users exist
    if (!users.length) {
        return
    }

    users.forEach(user => {
        // if undefined, do not write; if null, delete data by setting undefined; else, write new data
        if (data.dataLimit !== undefined) {
            user.dataLimit = data.dataLimit === null ? undefined : data.dataLimit
        }
        if (data.timeLimit !== undefined) {
            user.timeLimit = data.timeLimit === null ? undefined : data.timeLimit
        }
        if (data.peerLimit !== undefined) {
            user.peerLimit = data.peerLimit === null ? undefined : data.peerLimit
        }

        // write changes to database
        user.save()
    })

    return users
}

// clear user's attributes
async function clearUsers(filter) {
    // look up users in database
    let users = await User.find(filter).exec()

    // check if users exist
    if (!users.length) {
        return
    }

    users.forEach(user => {
        // reset the user's peers attributes and unblock them
        clearPeers({ user: user.name })

        // reset the user's usage attributes (just in case, can't hurt)
        user.upload = '0'
        user.download = '0'
        user.timeUsed = '0'

        // write changes to database
        user.save()
    })

    return users
}

// remove a user from the database
async function removeUsers(filter) {
    // look up users in database
    let users = await User.find(filter).exec()

    // check if users exist
    if (!users.length) {
        return
    }

    users.forEach(user => {
        // remove all peers belonging to the user
        removePeers({ user: user.name })

        // remove the user from the database
        user.remove()
    })

    return users
}

// read data from WireGuard CLI into the database (upload, download, time used, etc.)
async function checkStatus() {
    // check individual peers
    // get all active peers from CLI
    

    let jsonString = execSync('bash /home/ubuntu/wirapi2/json2.sh').toString()
    // console.log(jsonString)
    let peers = JSON.parse(jsonString).peers

    // loop through each peer
    for (i in peers) {

        // locate peer in the database
        let peer = await Peer.findOne({ publicKey: peers[i].publicKey })

        // check upload and download

        // check if WG CLI has inreased
        if (parseInt(peers[i].upload) > parseInt(peer.lastUpload) || parseInt(peers[i].download) > parseInt(peer.lastDownload)) {
            // the peer has used data
            // log the amount into upload and download counter

            peer.upload = parseInt(peer.upload) + peers[i].upload - parseInt(peer.lastUpload)
            peer.download = parseInt(peer.download) + peers[i].download - parseInt(peer.lastDownload)

            // check if the peer has exceeded the quota
            if (parseInt(peer.upload) + parseInt(peer.download) > parseInt(peer.dataLimit)) {
                // the peer has exceeded the quota, block further connections
                blockPeers({ publicKey: peer.publicKey })

                // notify the main site of the action
                sendMessage({
                    type: 'disable',
                    peer: peer.publicKey,
                    reason: 'data'
                })
            }
        }
        // if the WG CLI has decreased, then assume it has been reset, add untracked data to database (WG CLI cannot decrease, because it can only be added by the user using the connection)
        if (parseInt(peers[i].upload) < parseInt(peer.lastUpload) || parseInt(peers[i].download) < parseInt(peer.lastDownload)) {
            peer.upload = parseInt(peer.upload) + peers[i].upload
            peer.download = parseInt(peer.download) + peers[i].download
        }

        // try {
        // console.log("upload " + peers[i].upload + " download " + peers[i].download)
        // } catch(e) {
        //     console.log("nima error")
        // }
        // save lastUpload and lastDownload marker into database
        peer.lastUpload = peers[i].upload
        peer.lastDownload = peers[i].download

        // check time used

        // check if the peer has conducted a handshake (the latestHandshake will increment to current date every 2 minutes whenever a connection is maintained, so it will deviate the record in the database)
        if (peers[i].latestHandshake != peer.latestHandshake && peers[i].latestHandshake != '0') {
            // the peer has conducted a handshake

            peer.timeUsed = parseInt(peer.timeUsed) + 120 // 2 minutes in seconds

            // save marker into database
            peer.latestHandshake = peers[i].latestHandshake

            // check if the peer has exceeded the quota
            if (parseInt(peer.timeUsed) > parseInt(peer.timeLimit)) {
                // the peer has exceeded the quota, block further connection
                blockPeers({ publicKey: peer.publicKey })

                // notify the main site of the action
                sendMessage({
                    type: 'disable',
                    peer: peer.publicKey,
                    reason: 'time'
                })
            }
        }

        // save peer information into database
        peer.save()
    }

    // check individual users
    User.find()
        .then(async users => {
            // loop through each user
            for (i in users) {
                // get all peers belonged to the user
                let userPeers = await Peer.find({ user: users[i].name }).exec()

                // get the users total usage data from peers database and write to user database
                // try catch in case the user does not have any peers (array.reduce function would fail)
                try {
                    users[i].upload = userPeers.map(x => parseInt(x.upload)).reduce((a, b) => a + b)
                    users[i].download = userPeers.map(x => parseInt(x.download)).reduce((a, b) => a + b)
                    users[i].timeUsed = userPeers.map(x => parseInt(x.timeUsed)).reduce((a, b) => a + b)
                } catch (e) {

                }

                // check if the user has exceeded the data limit quota
                if (parseInt(users[i].upload) + parseInt(users[i].download) > parseInt(users[i].dataLimit)) {
                    // disable all of the user's peers
                    blockPeers({ user: users[i].name })

                    // notify the main site of the action
                    sendMessage({
                        type: 'disable',
                        user: users[i].name,
                        reason: 'data'
                    })
                }

                // check if the user has exceeded the time limit quota
                if (parseInt(users[i].timeUsed) > parseInt(users[i].timeLimit)) {
                    // disable all of the user's peers
                    blockPeers({ user: users[i].name })

                    // notify the main site of the action
                    sendMessage({
                        type: 'disable',
                        user: users[i].name,
                        reason: 'time'
                    })
                }

                users[i].save()
            }
        })

    // check individual peers in database

    // fetch the server object from database
    Server.findOne({ serverSettings: true })
        .then(server => {
            // console.log("server publicKey " + server.publicKey)
            // reset server statistics.
            server.upload = '0'
            server.download = '0'
            server.timeUsed = '0'

            // loop throuth each peer in database
            Peer.find()
                .then(dbPeers => {
                    dbPeers.forEach(dbPeer => {
                        // add peer information into server total
                        server.upload = (parseInt(server.upload) + parseInt(dbPeer.upload)).toString()
                        server.download = (parseInt(server.download) + parseInt(dbPeer.download)).toString()
                        server.timeUsed = (parseInt(server.timeUsed) + parseInt(dbPeer.timeUsed)).toString()
                    })
                })
                .then(() => {
                    // save server statistics
                    server.save()
                })
        })
}

// send a message back to the main site to inform it of changes (quota exceeded, etc)
function sendMessage(message) {
    if (process.env.MAIN_SITE_USE_HTTPS) {
        const https = require('https')

        const req = https.request({
            hostname: process.env.MAIN_SITE_DOMAIN,
            port: process.env.MAIN_SITE_PORT,
            path: process.env.MAIN_SITE_ROUTE,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': data.length
            }
        })

        req.write(message)
        req.end()
    } else {
        const http = require('http')

        const req = http.request({
            hostname: process.env.MAIN_SITE_DOMAIN,
            port: process.env.MAIN_SITE_PORT,
            path: process.env.MAIN_SITE_ROUTE,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': data.length
            }
        })

        req.write(message)
        req.end()
    }
}

// removes peers in WireGuard CLI and updates the database
async function blockPeers(args) {
    // look up the peer in database
    let peers = await Peer.find(args).exec()

    // check if the peers exist
    if (!peers.length) {
        return []
    }

    for (i in peers) {
        // add the peer to CLI
        // !! use peer.publicKey instead of publicKey to avoid command injection
        execSync('wg set wg0 peer ' + peers[i].publicKey + ' remove')
        peers[i].enabled = false
        await peers[i].save()
    }

    return peers.map(x => x.publicKey)
}

// restores peers in the WireGuard CLI and updates the database
async function unblockPeers(args) {
    // look up the peer in database
    let peers = await Peer.find(args).exec()

    // check if the peers exist
    if (!peers.length) {
        return []
    }

    for (i in peers) {
        // add the peer to CLI
        // !! use peer.publicKey instead of publicKey to avoid command injection
        execSync('wg set wg0 peer ' + peers[i].publicKey + ' allowed-ips ' + peers[i].allowedIP + '/32')
        peers[i].enabled = true
        await peers[i].save()
    }

    return peers.map(x => x.publicKey)
}

module.exports = {
    // meta functions
    initialize: initialize,
    checkStatus: checkStatus,
    // peer operations
    addPeer: addPeer,
    updatePeers: updatePeers,
    clearPeers: clearPeers,
    removePeers: removePeers,
    // user operations
    addUser: addUser,
    updateUsers: updateUsers,
    clearUsers: clearUsers,
    removeUsers: removeUsers,
}
