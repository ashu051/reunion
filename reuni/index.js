const express = require('express');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
app.use(express.json());

const secretKey = 'mysecretkey'; // Replace with a secure key in production

// Initialize a PostgreSQL connection pool
const pool = new Pool({
  connectionString: 'postgresql://postgres:root@localhost:5432/reunion',
  // Replace with your PostgreSQL credentials and database name
});

// Authentication middleware
app.use(async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      if (req.path === '/api/authenticate/' && req.method === 'POST' || req.path === '/api/user/' && req.method === 'GET' || req.path === '/api/posts/' && req.method === 'GET') {
        // Allow unauthenticated access to the /api/authenticate endpoint
        next();
      } else {
        return res.status(401).json({ message: 'Missing authorization header' });
      }
    } else {
      const [scheme, token] = authHeader.split(' ');
      if (scheme !== 'Bearer' || !token) {
        return res.status(401).json({ message: 'Invalid authorization header' });
      }
  
      try {
        const decodedToken = jwt.verify(token, secretKey);
        const query = 'SELECT id, email FROM users WHERE id = $1';
        const values = [decodedToken.id];
        const { rows } = await pool.query(query, values);
        const user = rows[0];
  
        if (!user) {
          return res.status(401).json({ message: 'Invalid user ID in token' });
        }
  
        req.user = user;
        next();
      } catch (error) {
        console.error(error);
        res.status(401).json({ message: 'Invalid or expired token' });
      }
    }
  });
  

// Authenticate user and return a JWT token
app.post('/api/authenticate', async (req, res) => {
  const { email, password } = req.body;

  try {
    // Look up user by email and password
    const query = 'SELECT id, email FROM users WHERE email = $1 AND password = $2';
    const values = [email, password];
    const { rows } = await pool.query(query, values);
    const user = rows[0];

    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Create a JWT token with the user ID and email as payload
    const token = jwt.sign({ id: user.id, email: user.email }, secretKey);

    // Return the JWT token and user ID in the response
    res.json({ token, user_id: user.id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Endpoint that requires authentication
app.get('/api/me', (req, res) => {
  res.json({ user_id: req.user.id });
});


app.post('/api/follow/:id', async (req, res) => {
    const id = req.params.id;
    console.log(id);
    console.log(req.user.id)
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query('INSERT INTO followers (user_id, follower_id, created_at) VALUES ($1, $2, NOW())', [id, req.user.id]);
      await client.query('COMMIT');
      res.status(200).json(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    } finally {
      client.release();
    }
  });
  app.post('/api/unfollow/:id', async (req, res) => {
    const id = req.params.id;
    console.log(id);
    console.log(req.user.id)
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query('DELETE FROM followers WHERE user_id = $1 AND follower_id = $2', [id, req.user.id]);
      await client.query('COMMIT');
      res.status(200).json(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    } finally {
      client.release();
    }
  });
  app.get('/api/user', async (req, res) => {
    try {
      const query = `
        SELECT 
          users.username,
          COUNT(followers.id) AS num_followers,
          COUNT(following.id) AS num_following
        FROM 
          users 
          LEFT JOIN followers ON users.id = followers.user_id 
          LEFT JOIN followers AS following ON users.id = following.follower_id 
        WHERE 
          users.id = $1 
        GROUP BY 
          users.id
      `;
      const values = [req.user.id];
      const { rows } = await pool.query(query, values);
      const userProfile = rows[0];
      if (!userProfile) {
        return res.status(404).json({ message: 'User not found' });
      }
      console.log(typeof(userProfile));
      res.json({
        name: userProfile.username,
        num_followers: userProfile.num_followers,
        num_following: userProfile.num_following
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });
  app.post('/api/posts/', async (req, res) => {
    try {
      const { title, description } = req.body;
      const userId = req.user.id;
      const query = `
        INSERT INTO posts (title, description, user_id)
        VALUES ($1, $2, $3)
        RETURNING id, title, description, created_at
      `;
      const values = [title, description, userId];
      const { rows } = await pool.query(query, values);
      const newPost = rows[0];
      res.json(newPost);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Server error' });
    }
  });
  app.delete('/api/posts/:id', async (req, res) => {
    try {
      const postId = req.params.id;
      const query = `
        DELETE FROM 
          posts 
        WHERE 
          id = $1 AND user_id = $2
        RETURNING 
          id, title, description, created_at
      `;
      const values = [postId, req.user.id];
      const { rows } = await pool.query(query, values);
      const deletedPost = rows[0];
      if (!deletedPost) {
        return res.status(404).json({ message: 'Post not found or you are not authorized to delete it' });
      }
      return res.json(deletedPost);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: 'Internal Server Error' });
    }
  });
  app.post('/api/like/:id', async (req, res) => {
    try {
      const postId = req.params.id;
      const userId = req.user.id;
      
      // Check if post exists
      const post = await pool.query('SELECT * FROM posts WHERE id = $1', [postId]);
      if (post.rows.length === 0) {
        return res.status(404).json({ message: 'Post not found' });
      }
  
      // Check if user has already liked the post
      const likedPost = await pool.query('SELECT * FROM likes WHERE post_id = $1 AND user_id = $2', [postId, userId]);
      if (likedPost.rows.length > 0) {
        return res.status(409).json({ message: 'You have already liked this post' });
      }
  
      // Add like to database
      const result = await pool.query('INSERT INTO likes (post_id, user_id) VALUES ($1, $2) RETURNING *', [postId, userId]);
      
      // Return success response
      res.status(201).json({
        message: 'Post liked',
        like: result.rows[0]
      });
    } catch (err) {
      console.error(err.message);
      res.status(500).json({ message: 'Server error' });
    }
  });
  app.post('/api/unlike/:id', async (req, res) => {
    const postId = req.params.id;
    const userId = req.user.id;
  
    try {
      const unlikeQuery = `
        DELETE FROM likes 
        WHERE post_id = $1 AND user_id = $2
      `;
      const unlikeValues = [postId, userId];
      await pool.query(unlikeQuery, unlikeValues);
  
      res.json({ message: 'Post unliked successfully' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Something went wrong' });
    }
  });
  app.post('/api/comment/:id', async (req, res) => {
    try {
      const postId = req.params.id;
      const comment = req.body.comment;
      const userId = req.user.id;
      const createdAt = new Date().toUTCString();
      const query = `
        INSERT INTO comments (post_id, user_id, comment, created_at)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `;
      const values = [postId, userId, comment, createdAt];
      const { rows } = await pool.query(query, values);
      const commentId = rows[0].id;
      res.json({ commentId });
    } catch (err) {
      console.error(err.message);
      res.status(500).json({ message: 'Server Error' });
    }
  });
  app.get('/api/posts/:id', async (req, res) => {
    try {
      const postId = req.params.id;
      const postQuery = `
        SELECT 
          posts.id,
          posts.title,
          posts.description,
          posts.created_at,
          COUNT(DISTINCT likes.id) AS num_likes,
          COUNT(DISTINCT comments.id) AS num_comments
        FROM 
          posts 
          LEFT JOIN likes ON posts.id = likes.post_id 
          LEFT JOIN comments ON posts.id = comments.post_id 
        WHERE 
          posts.id = $1 
        GROUP BY 
          posts.id
      `;
      const postValues = [postId];
      const { rows: [post] } = await pool.query(postQuery, postValues);
      if (!post) {
        return res.status(404).json({ message: 'Post not found' });
      }
      res.json(post);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });
  app.get('/api/all_posts', async (req, res) => {
    try {
      const query = `
        SELECT 
          posts.id,
          posts.title,
          posts.description,
          posts.created_at,
          COUNT(DISTINCT likes.id) AS likes,
          json_agg(json_build_object('id', comments.id, 'user_id', comments.user_id, 'comment', comments.comment, 'created_at', comments.created_at)) AS comments
        FROM 
          posts 
          LEFT JOIN likes ON posts.id = likes.post_id 
          LEFT JOIN comments ON posts.id = comments.post_id 
        GROUP BY 
          posts.id
        ORDER BY 
          posts.created_at DESC
      `;
    //   const values = [req.user.id];
      const { rows } = await pool.query(query);
      const posts = rows.map(row => ({
        id: row.id,
        title: row.title,
        desc: row.desc,
        created_at: row.created_at,
        likes: parseInt(row.likes) || 0,
        comments: row.comments || []
      }));
      console.log(posts);
      return res.json(posts);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: 'Internal server error' });
    }
  });
  
  
// Start the server
app.listen(3000, () => {
  console.log('Server listening on port 3000');
});
