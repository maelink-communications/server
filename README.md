<a href="https://ibb.co/h11T3vTV"><img src="https://i.ibb.co/3YYPgHPc/banner-protokol.png" alt="banner-protokol" border="0"></a>

## Server Ports

- **HTTP API**: `http://localhost:7000`
- **WebSocket**: `http://localhost:7001`

> [!NOTE]
> Documentation is in DOCS.md.
> If you have any questions, stop by our [Discord server!](https://discord.gg/QVeQBBuK87)

## Checklist...

### Completed
- User registration and authentication
- Home feed with pagination
- Post creation, editing, deletion
- Post liking system
- User profiles (view and edit)
- Inbox messaging system
- Guilds/Bubbles (create, join, leave, delete)
- Guild channels (create, edit, delete)
- Guild messaging
- Real-time updates via Websockets
- Guild member listing with usernames

### In progress / TODO
- Commenting on posts
- Replying to posts
- Settings management
- Admin/moderator features
- User roles and permissions

## Running the server

1. Clone this repo and `cd` into the folder
2. Ensure you have Deno installed
3. install required packages with `deno task install`
4. Run `deno task start` to start the server
5. Run `deno test.js --allow-all --env-file [-- <args>]` and the program will automatically test endpoints and report errors for you
