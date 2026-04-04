// Main logic.
// MAKE SURE YOU HAVE A .env FILE WITH THE JWT_SECRET SET!!!
// Otherwise, authentication will NOT work and tokens will NOT be generated.
import { register, login } from "./auth.js";
import { createPost, fetchPosts } from "./home.js";
import { initDB } from "./db.js";
import { log } from "./logging.js";

initDB();

Deno.serve({ port: 7000, onListen: () => {} }, async (req) => {
  const url = new URL(req.url);
  if (url.pathname === "/register" && req.method === "POST") {
    const { username, password } = await req.json();
    const reg = await register(username, password);
    return new Response(JSON.stringify({ reg }), {
      headers: { "Content-Type": "application/json" },
    });
  } else if (url.pathname === "/login" && req.method === "POST") {
    const { username, password } = await req.json();
    const user = await login(username, password);
    if (!user) {
      return new Response(JSON.stringify({ error: true }), {
        headers: { "Content-Type": "application/json" },
        status: 404,
      });
    }
    return new Response(JSON.stringify({ error: false, user }), {
      headers: { "Content-Type": "application/json" },
    });
  } else if (url.pathname === "/post" && req.method === "POST") {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: true }), {
        headers: { "Content-Type": "application/json" },
        status: 401,
      });
    }
    const postdata = await req.json();
    const token = authHeader.split(" ")[1];
    try {
      const post = await createPost(token, postdata.userId, postdata.content);
      if (!post) {
        return new Response(JSON.stringify({ error: true }), {
          headers: { "Content-Type": "application/json" },
          status: 400,
        });
      }
      return new Response(JSON.stringify({ error: false }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (e) {
      log(e, "red");
      return new Response(JSON.stringify({ error: true }), {
        headers: { "Content-Type": "application/json" },
        status: 400,
      });
    }
  } else if (url.pathname === "/home" && req.method === "POST") {
    const pageHeader = req.headers.get("p");
    let page = 1;
    if (pageHeader) {
      page = parseInt(pageHeader);
    }
    try {
      const returnedPosts = await fetchPosts(page);
      return new Response(
        JSON.stringify({ error: false, page: page, posts: returnedPosts }),
        {
          headers: { "Content-Type": "application/json" },
        },
      );
    } catch (e) {
      log(e, "red");
      return new Response(JSON.stringify({ error: true }), {
        headers: { "Content-Type": "application/json" },
        status: 400,
      });
    }
  } else if (url.pathname === "/post" && req.method === "PATCH") {
    // unimplemented
    return new Response(JSON.stringify({ error: true }), {
      headers: { "Content-Type": "application/json" },
      status: 501,
    });
  } else if (url.pathname === "/post" && req.method === "DELETE") {
    // unimplemented
    return new Response(JSON.stringify({ error: true }), {
      headers: { "Content-Type": "application/json" },
      status: 501,
    });
  } else {
    return new Response(JSON.stringify({ error: true }), {
      headers: { "Content-Type": "application/json" },
      status: 404,
    });
  }
});

log("PROTOKOL | Server is running on http://localhost:7000", "magenta");
