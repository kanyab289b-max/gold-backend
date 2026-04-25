const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());

// ========== API KEYS ==========
const TWELVE_KEY = process.env.TWELVEDATA_KEY;

// ========== CACHE SYSTEM ==========
let cache = { M5: null, M15: null, H1: null, timestamp: 0 };
const CACHE_TTL = 30000; // 30 วินาที

// ========== FETCH TWELVE DATA ==========
async function fetchTwelveData(interval, limit = 80) {
    if (!TWELVE_KEY) {
        console.log('⚠️ ไม่มี Twelve Data API key');
        return null;
    }
    
    const url = `https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=${interval}&outputsize=${limit}&apikey=${TWELVE_KEY}`;
    
    try {
        const res = await fetch(url);
        const data = await res.json();
        if (!data.values || data.values.length === 0) throw new Error('No data');
        
        console.log(`✅ Twelve Data (${interval}) สำเร็จ`);
        
        return data.values.map(v => ({
            open: parseFloat(v.open),
            high: parseFloat(v.high),
            low: parseFloat(v.low),
            close: parseFloat(v.close),
            time: v.datetime
        })).reverse();
    } catch (error) {
        console.log(`❌ Twelve Data Error (${interval}):`, error.message);
        return null;
    }
}

// ========== MOCK DATA (FALLBACK) ==========
function generateMockData() {
    const data = [];
    let price = 4700;
    for (let i = 0; i < 80; i++) {
        const change = (Math.random() - 0.5) * 8;
        const close = price + change;
        data.push({
            open: parseFloat(price.toFixed(2)),
            high: parseFloat((Math.max(price, close) + Math.random() * 4).toFixed(2)),
            low: parseFloat((Math.min(price, close) - Math.random() * 4).toFixed(2)),
            close: parseFloat(close.toFixed(2)),
            time: new Date(Date.now() - (80 - i) * 5 * 60000).toISOString()
        });
        price = close;
    }
    return data;
}

// ========== FETCH WITH FALLBACK ==========
async function fetchWithFallback(interval) {
    let data = await fetchTwelveData(interval);
    if (data) return data;
    
    console.log(`⚠️ ใช้ Mock Data (${interval})`);
    return generateMockData();
}

// ========== MAIN ENDPOINT ==========
app.get('/api/market', async (req, res) => {
    const now = Date.now();
    
    if (cache.M5 && now - cache.timestamp < CACHE_TTL) {
        return res.json({
            M5: cache.M5,
            M15: cache.M15,
            H1: cache.H1,
            cached: true
        });
    }
    
    try {
        const [M5, M15, H1] = await Promise.all([
            fetchWithFallback('5min'),
            fetchWithFallback('15min'),
            fetchWithFallback('1h')
        ]);
        
        cache = { M5, M15, H1, timestamp: now };
        
        res.json({ M5, M15, H1, cached: false, source: 'twelvedata' });
        
    } catch (error) {
        res.status(500).json({
            error: 'API ล่ม',
            M5: generateMockData(),
            M15: generateMockData(),
            H1: generateMockData(),
            isMock: true
        });
    }
});

app.get('/', (req, res) => {
    res.send('Gold Backend Running (Twelve Data)');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`📡 Twelve Data: ${TWELVE_KEY ? '✅' : '❌'}`);
});