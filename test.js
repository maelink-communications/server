import { assert, assertEquals } from "@std/assert";
import { Database } from "@db/sqlite";

let destroyPost;
let BASE_URL;
let unlike;

if (!Deno.args.includes("devserver")) {
  BASE_URL = "http://localhost:7000";
} else {
  BASE_URL = "https://dev.maelink.net";
}

if (!Deno.args.includes("seepost")) {
  destroyPost = true;
} else {
  destroyPost = false;
}

if (Deno.args.includes("unlike")) {
  unlike = true;
} else {
  unlike = false;
}

// Parse additional nodes from args: --node=http://localhost:7001
for (const arg of Deno.args) {
  if (arg.startsWith("--node=")) {
    NODES.push(arg.split("=")[1]);
  }
}

async function request(method, path, body, headers = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    // ignore non-json responses
  }

  return { res, data };
}

function getDB(dbPath = "main.db") {
  return new Database(dbPath);
}

async function verifyPostInDB(db, postUuid, shouldExist = true) {
  const post = db.prepare(`SELECT * FROM posts WHERE uuid = ?`).value(postUuid);
  if (shouldExist) {
    assert(post !== undefined, `Post ${postUuid} should exist in DB`);
  } else {
    assert(post === undefined, `Post ${postUuid} should NOT exist in DB`);
  }
  return post;
}

async function verifyUserInDB(db, userUuid, expectedData = {}) {
  const user = db.prepare(`SELECT * FROM users WHERE uuid = ?`).value(userUuid);
  assert(user !== undefined, `User ${userUuid} should exist in DB`);
  if (expectedData.username) {
    assertEquals(user[2], expectedData.username, `Username mismatch in DB`);
  }
  if (expectedData.bio !== undefined) {
    assertEquals(user[5], expectedData.bio, `Bio mismatch in DB`);
  }
  return user;
}

Deno.test("API flow", async (t) => {
  const unique = Date.now().toString();
  const username = `testuser_${unique}`;
  const password = "TestPassword123!";

  let token = null;
  let postId = null;
  let postUuid = null;
  let userId = null;
  const db = getDB();

  await t.step("Register user", async () => {
    const { res, data } = await request("POST", "/register", {
      username,
      password,
    });

    assert(res.status === 200 || res.status === 201);
    assert(data);
  });

  await t.step("Login user", async () => {
    const { res, data } = await request("POST", "/login", {
      username,
      password,
    });
    console.log("Data from login request: ", data);

    assertEquals(res.status, 200);
    assert(data && data.user && data.user.token);

    token = data.user.token;
    userId = data.user.uuid;
  });

  await t.step("Create post", async () => {
    if (!token || !userId) return;

    const { res, data } = await request(
      "POST",
      "/post",
      {
        content: `Test post at ${new Date().toISOString()}`,
      },
      {
        Authorization: `Bearer ${token}`,
      },
    );
    console.log("Post creation response data: ", data);

    assertEquals(res.status, 200);
    postId = data.postId;
    postUuid = data.postUuid;

    // Verify in local DB
    const dbPost = await verifyPostInDB(db, postUuid, true);
    if (dbPost) {
      console.log(`✓ Post ${postUuid} verified in local DB`);
    }
  });

  await t.step("Like post", async () => {
    const { res, data } = await request(
      "PATCH",
      "/post",
      { like: true, postId: postId },
      { Authorization: `Bearer ${token}` },
    );
    console.log("Like post response status: ", data);
    assertEquals(res.status, 200);

    // Verify like in local DB
    const dbPost = db
      .prepare(`SELECT likes, users_liked FROM posts WHERE uuid = ?`)
      .value(postUuid);
    assert(dbPost[0] >= 1, "Post should have at least 1 like");
    const liked = JSON.parse(dbPost[1]);
    assert(liked.includes(userId), "User should be in users_liked array");
    console.log(`✓ Like verified in local DB`);
  });

  if (unlike) {
    await t.step("Unlike post", async () => {
      const { res, data } = await request(
        "PATCH",
        "/post",
        { like: true, postId: postId },
        { Authorization: `Bearer ${token}` },
      );
      console.log("Unlike post response status: ", data);
      assertEquals(res.status, 200);
    });
  }

  await t.step("Fetch posts page 1", async () => {
    const { res, data } = await request("GET", "/home", undefined, { p: "1" });
    console.log(`Fetch posts response data: ${JSON.stringify(data)}`);
    assertEquals(res.status, 200);
  });

  await t.step("Fetch posts page 2", async () => {
    const { res, data } = await request("GET", "/home", undefined, { p: "2" });
    console.log(`Fetch posts [page 2] response data: ${JSON.stringify(data)}`);
    assertEquals(res.status, 200);
  });

  await t.step("Fetch inbox messages", async () => {
    console.log(`Fetching inbox messages with token: ${token}`);
    const { res, data } = await request("GET", "/inbox", undefined, {
      Authorization: `Bearer ${token.toString()}`,
    });
    console.log(`Fetch inbox messages response data: ${JSON.stringify(data)}`);
    assertEquals(res.status, 200);
  });

  await t.step("PATCH /post", async () => {
    if (!token) return;

    const { res } = await request(
      "PATCH",
      "/post",
      { postId: postId, content: "Updated content" },
      { Authorization: `Bearer ${token}` },
    );

    assert(res.status >= 200);
  });

  await t.step("Guild endpoints coverage", async () => {
    if (!token) return;

    const guildHeaders = { Authorization: `Bearer ${token}` };

    const createGuild = await request(
      "POST",
      "/guilds",
      { name: `Guild ${unique}`, description: "Guild test" },
      guildHeaders,
    );
    assert(createGuild.res.status !== 404, "POST /guilds should be registered");

    const guildId = createGuild.data?.guilds?.id ?? createGuild.data?.id;
    if (guildId) {
      const listGuilds = await request("GET", "/guilds", undefined, guildHeaders);
      assert(listGuilds.res.status !== 404, "GET /guilds should be registered");

      const getGuildPosts = await request("GET", `/guild/${guildId}`, undefined, guildHeaders);
      assert(getGuildPosts.res.status !== 404, "GET /guild/:guildId should be registered");

      const editGuild = await request(
        "PATCH",
        `/guild/${guildId}`,
        { name: `Updated ${unique}`, description: "Updated guild" },
        guildHeaders,
      );
      assert(editGuild.res.status !== 404, "PATCH /guild/:guildId should be registered");

      const postToGuild = await request(
        "POST",
        `/guild/${guildId}`,
        { content: "Guild post" },
        guildHeaders,
      );
      assert(postToGuild.res.status !== 404, "POST /guild/:guildId should be registered");

      const getChannels = await request("GET", `/guild/channels/${guildId}`, undefined, guildHeaders);
      assert(getChannels.res.status !== 404, "GET /guild/channels/:guildId should be registered");

      const createChannel = await request(
        "POST",
        "/guild/channels",
        { guildId, name: `general-${unique}` },
        guildHeaders,
      );
      assert(createChannel.res.status !== 404, "POST /guild/channels should be registered");

      const channelId = createChannel.data?.channel?.id ?? createChannel.data?.id;
      if (channelId) {
        const patchChannel = await request(
          "PATCH",
          `/guild/channels/${guildId}`,
          { channelId, name: `updated-${unique}` },
          guildHeaders,
        );
        assert(patchChannel.res.status !== 404, "PATCH /guild/channels/:guildId should be registered");

        const deleteChannel = await request(
          "DELETE",
          "/guild/channels",
          { guildId, channelId },
          guildHeaders,
        );
        assert(deleteChannel.res.status !== 404, "DELETE /guild/channels should be registered");
      }

      const deleteGuild = await request("DELETE", `/guild/${guildId}`, undefined, guildHeaders);
      assert(deleteGuild.res.status !== 404, "DELETE /guild/:guildId should be registered");
    }
  });

  if (destroyPost) {
    await t.step("DELETE /post", async () => {
      if (!token) return;

      const { res } = await request(
        "DELETE",
        "/post",
        { postId: postId },
        { Authorization: `Bearer ${token}` },
      );

      assert(res.status >= 200);

      // Verify deletion in local DB
      await verifyPostInDB(db, postUuid, false);
      console.log(`✓ Post ${postUuid} deletion verified in local DB`);
    });
  } else {
    console.log(
      "Skipping DELETE /post test. Run without seepost to enable it.",
    );
  }

  await t.step("404 handling", async () => {
    const { res } = await request("GET", "/nonexistent");
    assertEquals(res.status, 404);
  });

  await t.step("Missing auth header", async () => {
    const { res } = await request("POST", "/post", {
      userId: "test-id",
      content: "This should fail",
    });

    assert(res.status === 401 || res.status === 403);
  });

  await t.step("Invalid login", async () => {
    const { res } = await request("POST", "/login", {
      username: "nonexistent_user",
      password: "WrongPassword123!",
    });

    assert(res.status >= 400);
  });

  await t.step("Get user data", async () => {
    if (!token) return;

    const { res, data } = await request("GET", "/user/" + userId, undefined, {
      Authorization: `Bearer ${token}`,
    });

    assertEquals(res.status, 200);
    console.log("User data:", data);
  });

  await t.step("Update user", async () => {
    if (!token) return;

    const newUsername = `updated_${username}`;
    const newBio = "Updated bio";

    const patch = await request(
      "PATCH",
      "/user",
      { username: newUsername, bio: newBio },
      { Authorization: `Bearer ${token}` },
    );

    assert(patch.res.status === 200 || patch.res.status === 204);

    // Verify update in local DB
    await verifyUserInDB(db, userId, { username: newUsername, bio: newBio });
    console.log(`✓ User ${userId} update verified in local DB`);
  });
});
