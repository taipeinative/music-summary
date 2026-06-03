const express = require('express');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const cors = require('cors');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

const originalCsvPath = path.join(__dirname, '../../../data/.legacy/library.csv');
const reviewedCsvPath = path.join(__dirname, '../../../data/.legacy/library_reviewed.csv');

app.get('/api/tracks', (req, res) => {
    const results = [];
    const csvPath = fs.existsSync(reviewedCsvPath) ? reviewedCsvPath : originalCsvPath;
    
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

app.post('/api/save', (req, res) => {
    const { trackId, genre, genre_tag } = req.body;
    const targetCsv = fs.existsSync(reviewedCsvPath) ? reviewedCsvPath : originalCsvPath;
    const results = [];
    let headers = [];
    
    fs.createReadStream(targetCsv)
        .pipe(csv())
        .on('headers', (h) => headers = h)
        .on('data', (data) => {
            if (data.legacy_id === trackId) {
                data.genre = genre || '';
                data.genre_tag = genre_tag || '';
            }
            results.push(data);
        })
        .on('end', () => {
            try {
                const headerStr = headers.map(h => `"${h}"`).join(',');
                const rowsStr = results.map(row => {
                    return headers.map(h => {
                        let val = row[h];
                        val = (val === null || val === undefined) ? '' : String(val);
                        if (val.includes(',') || val.includes('"') || val.includes('\n')) {
                            return `"${val.replace(/"/g, '""')}"`;
                        }
                        return val;
                    }).join(',');
                }).join('\n');
                fs.writeFileSync(reviewedCsvPath, headerStr + '\n' + rowsStr, 'utf8');
                res.json({ success: true });
            } catch (e) {
                console.error(e);
                res.status(500).json({ error: 'Failed to save data' });
            }
        })
        .on('error', (err) => res.status(500).json({ error: 'Failed to process saving' }));
});

app.listen(port, () => {
    console.log(`Server listening on http://localhost:${port}`);
});
