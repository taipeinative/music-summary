const express = require('express');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const cors = require('cors');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.static('public'));

app.get('/api/tracks', (req, res) => {
    const results = [];
    const csvPath = path.join(__dirname, '../../../data/.legacy/library.csv');
    
    fs.createReadStream(csvPath)
        .pipe(csv())
        .on('data', (data) => {
            results.push(data);
        })
        .on('end', () => {
            res.json(results);
        })
        .on('error', (err) => {
            console.error(err);
            res.status(500).json({ error: 'Failed to read data' });
        });
});

app.listen(port, () => {
    console.log(`Server listening on http://localhost:${port}`);
});
