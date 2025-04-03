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

// MySQL connection pool
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'cognitieve_registratie',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Middleware
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

// Serve static files
app.use(express.static(__dirname));

// Password check middleware
const checkPassword = (req, res, next) => {
    if (req.session.authenticated || req.path === '/login') {
        return next();
    }
    res.redirect('/login');
};

// Apply password check to all routes except login
app.use(checkPassword);

// Routes
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.post('/login', (req, res) => {
    if (req.body.password === PASSWORD) {
        req.session.authenticated = true;
        return res.redirect('/');
    }
    res.redirect('/login?error=1');
});

app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return console.log(err);
        }
        res.redirect('/login');
    });
});

// API Routes for registrations
app.get('/api/registraties', async (req, res) => {
    try {
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

        const [rows] = await pool.query(query, params);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

app.post('/api/registraties', async (req, res) => {
    try {
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

        await pool.query(query, [
            id, gebeurtenis, datum, automatische_gedachten, 
            gevoel, uitdagen_gedachten, gecorrigeerde_gedachten,
            gedrag, resultaat, completed
        ]);

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

app.delete('/api/registraties/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM registraties WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Main route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});