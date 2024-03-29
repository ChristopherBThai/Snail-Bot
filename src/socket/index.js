const { Server } = require('socket.io');
const io = new Server();

const LISTENERS = require('require-dir')('./');

class SocketHandler {
    constructor(bot) {
        this.handlers = [];
        let filename = __filename.slice(__dirname.length + 1, -3);
        for (let listener in LISTENERS) {
            if (listener != filename) {
                const handler = new LISTENERS[listener](bot);
                handler.name = listener;
                this.handlers.push(handler);
                setTimeout(() => {
                    handler.init && handler.init();
                }, 10000);
            }
        }

        io.on('error', (err) => {
            console.log(err);
        });

        io.on('disconnect', (socket) => {
            console.log('Disconnected: ', socket.id);
        });

        io.on('connection', (socket) => {
            if (socket.handshake.auth.token != process.env.SOCKET_TOKEN) {
                console.log('UNAUTHORIZED: ', socket);
                return;
            }
            console.log('Connected: ', socket.id);
            this.handlers.forEach((handler) => {
                socket.on(handler.name, handler.handle.bind(handler));
            });
        });

        // @ts-ignore
        io.listen(process.env.SOCKET_PORT);
    }
}

module.exports = SocketHandler;
