// Main logic.
// MAKE SURE YOU HAVE A .env FILE WITH THE JWT_SECRET SET!!!
// Otherwise, authentication will NOT work and tokens will NOT be generated.
import { register, login } from "./auth.js";
import { createPost, editPost, fetchPosts, destroyPost } from "./home.js";
import { fetchUser, editUser } from "./me.js";
import { initDB } from "./db.js";
import { log } from "./logging.js";

initDB();

Deno.serve({ port: 7000, onListen: () => {} }, async (req) => {
  const url = new URL(req.url);
  if (url.pathname === "/register" && req.method === "POST") {
    const { username, password } = await req.json();
    const reg = await register(username, password);
    return Response.json({ reg: reg });
  } else if (url.pathname === "/login" && req.method === "POST") {
    const { username, password } = await req.json();
    const user = await login(username, password);
    console.log("user: ", user);
    if (!user) {
      return Response.json({ error: true }, { status: 404 });
    }
    return Response.json({ error: false, user: user }, { status: 200 });
  } else if (url.pathname === "/post" && req.method === "POST") {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return Response.json({ error: true }, { status: 401 });
    }
    const postdata = await req.json();
    const token = authHeader.split(" ")[1];
    try {
      const post = await createPost(token, postdata.userId, postdata.content);
      if (!post) {
        return Response.json({ error: true }, { status: 400 });
      }
      return Response.json({ error: false });
    } catch (e) {
      log(e, "red");
      return Response.json({ error: true }, { status: 400 });
    }
  } else if (url.pathname === "/home" && req.method === "POST") {
    const pageHeader = req.headers.get("p");
    let page = 1;
    if (pageHeader) {
      page = parseInt(pageHeader);
    }
    try {
      const returnedPosts = await fetchPosts(page);
      return Response.json({ error: false, page: page, posts: returnedPosts });
    } catch (e) {
      log(e, "red");
      return Response.json({ error: true }, { status: 400 });
    }
  } else if (url.pathname === "/post" && req.method === "PATCH") {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return Response.json({ error: true }, { status: 401 });
    }
    const postdata = await req.json();
    const token = authHeader.split(" ")[1];
    try {
      const post = await editPost(token, postdata.postId, postdata.userId, postdata.content);
      if (!post) {
        return Response.json({ error: true }, { status: 400 });
      }
      return Response.json({ error: false });
    } catch (e) {
      log(e, "red");
      return Response.json({ error: true }, { status: 400 });
    }
  } else if (url.pathname === "/post" && req.method === "DELETE") {
    const authHeader = req.headers.get("Authorization");
    const token = authHeader.split(" ")[1];
    const postdata = await req.json();
    try {
      const post = await destroyPost(token, postdata.postId, postdata.userId);
      if (!post) {
        return Response.json({ error: true }, { status: 400 });
      }
      return Response.json({ error: false })
    } catch (e) {
      log(e, "red");
      return Response.json({ error: true }, { status: 400 });
    }
  } else if (url.pathname.startsWith("/user/") && req.method === "GET") {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return Response.json({ error: true }, { status: 401 });
    }
    const userId = url.pathname.split("/")[2];
    const token = authHeader.split(" ")[1];
    try {
      const user = await fetchUser(token, userId);
      if (!user) {
        return Response.json({ error: true }, { status: 400 });
      }
      return Response.json({ error: false, user: user });
    } catch (e) {
      log(e, "red");
      return Response.json({ error: true }, { status: 400 });
    }
  } else if (url.pathname === "/user" && req.method === "PATCH") {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return Response.json({ error: true }, { status: 401 });
    }
    const userdata = await req.json();
    const token = authHeader.split(" ")[1];
    try {
      const user = await editUser(token, userdata.id, userdata.username, userdata.pfp, userdata.bio);
      if (!user) {
        return Response.json({ error: true }, { status: 400 });
      }
      return Response.json({ error: false });
    } catch (e) {
      log(e, "red");
      return Response.json({ error: true }, { status: 400 });
    }
  } else {
    return Response.json({ error: true }, { status: 404 });
  }
});

log("PROTOKOL | Server is running on http://localhost:7000", "magenta");
