<a href="https://ibb.co/h11T3vTV"><img src="https://i.ibb.co/3YYPgHPc/banner-protokol.png" alt="banner-protokol" border="0"></a>

## Server Ports

- **HTTP API**: `http://localhost:7000`
- **WebSocket**: `http://localhost:7001`

> [!NOTE]
> Documentation is in DOCS.md.
> If you have any questions, stop by our [Discord server!](https://discord.gg/QVeQBBuK87)

### In progress / TODO
- Commenting on posts
- Replying to posts
- Admin/moderator features
- Uploads and emojis
- Compilation process for binary artifacts of the server

## Running the server

1. Clone this repo and `cd` into the folder
2. Ensure you have Deno installed
3. install required packages with `deno task install`
4. Run `deno task start` to start the server
5. Run `deno test.js --allow-all --env-file [-- <args>]` and the program will automatically test endpoints and report errors for you
