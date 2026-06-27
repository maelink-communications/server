<a href="https://ibb.co/h11T3vTV"><img src="https://i.ibb.co/3YYPgHPc/banner-protokol.png" alt="banner-protokol" border="0"></a>

## Server Ports

- **HTTP API**: `http://localhost:7000`
- **Socket.io**: `http://localhost:7001`

## Registered Endpoints

### Authentication
- `POST /register` - Register a new user
- `POST /login` - Authenticate a user (token expires in 2 hours)

### Home Feed
- `GET /home` - Fetch home posts (optional "p" header for page number)
- `POST /post` - Create a new post (requires Authorization header)
- `PATCH /post` - Update or like/unlike a post (requires Authorization header, use `like: true` for liking)
- `DELETE /post` - Delete post (requires Authorization header, requires `postId` in body)

### User
- `GET /user/:userId` - Fetch user profile (requires Authorization header)
- `PATCH /user` - Edit own profile (requires Authorization header)

### Inbox
- `GET /inbox` - Fetch inbox messages (requires Authorization header, optional "p" header)
- `PATCH /inbox` - Mark message as read (requires Authorization header and `message_id` in body)

### Guilds/Bubbles
- `GET /guilds` - List all guilds (requires Authorization header)
- `POST /guilds` - Create a guild (requires Authorization header, needs `name` and `description`)
- `GET /guild/:guildId` - Fetch guild posts (requires Authorization header)
- `PATCH /guild/:guildId` - Edit guild details (requires Authorization header)
- `DELETE /guild/:guildId` - Delete guild (requires Authorization header)
- `POST /guild/:guildId/join` - Join a guild (requires Authorization header)
- `DELETE /guild/:guildId/leave` - Leave a guild (requires Authorization header)
- `GET /guild/:guildId/members` - Get guild members with usernames (requires Authorization header)

### Channels
- `GET /guild/channels/:guildId` - Fetch guild channels (requires Authorization header)
- `POST /guild/channels` - Create channel (requires Authorization header, needs `guildId` and `name`)
- `PATCH /guild/channels/:guildId` - Edit channel (requires Authorization header)
- `DELETE /guild/channels` - Delete channel (requires Authorization header)

### Guild Posts
- `POST /guild/:guildId/:channelId` - Post message to guild channel (requires Authorization header)

### Socket.io Events (Port 7001)

**Client to Server:**
- `auth` - Authenticate with JWT token

**Server to Client:**
- `authenticated` - Confirmation of successful authentication
- `error` - Error message
- `home:post` - New home post created
- `home:post:edit` - Home post edited
- `home:post:delete` - Home post deleted
- `guild:post` - New guild message (only to guild members)
- `guild:update` - Guild details updated
- `guild:channel:create` - New channel created
- `guild:channel:delete` - Channel deleted
- `inbox:message` - New inbox message (only to recipient)

## Features Implemented

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
- Real-time updates via Socket.io
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
