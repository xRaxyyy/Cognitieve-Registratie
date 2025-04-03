require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const mysql = require('mysql2/promise');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;
const PASSWORD = process.env.APP_PASSWORD || 'defaultpassword';

// Debug function
const debug = (message, data = null) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] DEBUG: ${message}`);
    if (data) {
        console.log(`[${timestamp}] DATA:`, JSON.stringify(data, null, 2));
    }
};

// MySQL connection pool with debug
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'cognitieve_registratie',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Verify database connection on startup
pool.getConnection()
    .then(conn => {
        debug('Successfully connected to MySQL database');
        conn.release();
    })
    .catch(err => {
        debug('Failed to connect to MySQL database', err);
        process.exit(1);
    });

// Middleware with debug
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false,
        maxAge: null,
        httpOnly: true
    }
}));

// Debug middleware for all requests
app.use((req, res, next) => {
    debug(`Incoming request: ${req.method} ${req.path}`);
    debug('Request headers:', req.headers);
    debug('Request body:', req.body);
    debug('Session:', req.session);
    next();
});

// Serve static files
app.use(express.static(__dirname));

// Password check middleware with debug
const checkPassword = (req, res, next) => {
    debug('Checking authentication status');
    if (req.session.authenticated || req.path === '/login') {
        debug('Authentication successful or login page');
        return next();
    }
    debug('Authentication failed - redirecting to login');
    res.redirect('/login');
};

// Apply password check to all routes except login
app.use(checkPassword);

// Routes with debug
app.get('/login', (req, res) => {
    debug('Serving login page');
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.post('/login', (req, res) => {
    debug('Login attempt', { providedPassword: req.body.password });
    if (req.body.password === PASSWORD) {
        req.session.authenticated = true;
        debug('Login successful');
        return res.redirect('/');
    }
    debug('Login failed - wrong password');
    res.redirect('/login?error=1');
});

app.get('/logout', (req, res) => {
    debug('Logout request received');
    req.session.destroy((err) => {
        if (err) {
            debug('Error destroying session', err);
            return console.log(err);
        }
        debug('Session destroyed - redirecting to login');
        res.redirect('/login');
    });
});

// API Routes for registrations with enhanced debug
app.get('/api/registraties', async (req, res) => {
    try {
        debug('Fetching registrations with filters', {
            statusFilter: req.query.status,
            searchTerm: req.query.search,
            sortOrder: req.query.sort
        });

        const statusFilter = req.query.status || 'all';
        const searchTerm = req.query.search || '';
        const sortOrder = req.query.sort || 'newest';

        let query = 'SELECT * FROM registraties';
        const conditions = [];
        const params = [];

        if (statusFilter !== 'all') {
            conditions.push('completed = ?');
            params.push(statusFilter === 'completed' ? 1 : 0);
        }

        if (searchTerm) {
            conditions.push('gebeurtenis LIKE ?');
            params.push(`%${searchTerm}%`);
        }

        if (conditions.length) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ' ORDER BY created_at ' + (sortOrder === 'oldest' ? 'ASC' : 'DESC');

        debug('Final SQL query:', { query, params });

        const [rows] = await pool.query(query, params);
        debug('Query successful - rows returned:', rows);
        res.json(rows);
    } catch (err) {
        debug('Database error in GET /api/registraties', err);
        res.status(500).json({ 
            error: 'Database error',
            details: err.message,
            stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
        });
    }
});

app.post('/api/registraties', async (req, res) => {
    try {
        debug('Creating/updating registration', req.body);

        const {
            id,
            gebeurtenis,
            datum,
            automatische_gedachten,
            gevoel,
            uitdagen_gedachten,
            gecorrigeerde_gedachten,
            gedrag,
            resultaat,
            completed
        } = req.body;

        const query = `
            INSERT INTO registraties (
                id, gebeurtenis, datum, automatische_gedachten, 
                gevoel, uitdagen_gedachten, gecorrigeerde_gedachten, 
                gedrag, resultaat, completed
            ) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                gebeurtenis = VALUES(gebeurtenis),
                datum = VALUES(datum),
                automatische_gedachten = VALUES(automatische_gedachten),
                gevoel = VALUES(gevoel),
                uitdagen_gedachten = VALUES(uitdagen_gedachten),
                gecorrigeerde_gedachten = VALUES(gecorrigeerde_gedachten),
                gedrag = VALUES(gedrag),
                resultaat = VALUES(resultaat),
                completed = VALUES(completed)
        `;

        const params = [
            id, gebeurtenis, datum, automatische_gedachten, 
            gevoel, uitdagen_gedachten, gecorrigeerde_gedachten,
            gedrag, resultaat, completed
        ];

        debug('Executing SQL query', { query, params });

        const [result] = await pool.query(query, params);
        debug('Query result:', result);

        res.json({ success: true });
    } catch (err) {
        debug('Database error in POST /api/registraties', err);
        res.status(500).json({ 
            error: 'Database error',
            details: err.message,
            stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
        });
    }
});

app.delete('/api/registraties/:id', async (req, res) => {
    try {
        debug('Deleting registration', { id: req.params.id });
        
        const [result] = await pool.query('DELETE FROM registraties WHERE id = ?', [req.params.id]);
        debug('Delete result:', result);

        if (result.affectedRows === 0) {
            debug('No registration found with that ID');
            return res.status(404).json({ error: 'Registration not found' });
        }

        res.json({ success: true });
    } catch (err) {
        debug('Database error in DELETE /api/registraties/:id', err);
        res.status(500).json({ 
            error: 'Database error',
            details: err.message,
            stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
        });
    }
});

// Main route with debug
app.get('/', (req, res) => {
    debug('Serving main application page');
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Error handling middleware with debug
app.use((err, req, res, next) => {
    debug('Unhandled error occurred', err);
    res.status(500).json({
        error: 'Internal server error',
        message: err.message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
});

app.listen(PORT, () => {
    debug(`Server started on http://localhost:${PORT}`);
    debug('Environment variables:', {
        DB_HOST: process.env.DB_HOST,
        DB_USER: process.env.DB_USER,
        DB_NAME: process.env.DB_NAME,
        NODE_ENV: process.env.NODE_ENV
    });
});