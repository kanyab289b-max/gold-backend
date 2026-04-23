const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());

// ========== 1. CACHE SYSTEM ==========
let cache = {
    M5: null,
    M15: null,
    H1: null,
    timestamp: 0
};
const CACHE_TTL = 120000; // 2 นาที

// ========== 2. API USAGE COUNTER ==========
let twelveDataCalls = 0;
let lastReset = Date.now();

function resetDailyCounter() {
    const now = Date.now();
    if (now - lastReset > 86400000) {
        twelveDataCalls = 0;
        lastReset = now;
        console.log('🔄 รีเซ็ต Twelve Data counter เรียบร้อย');
    }
}

// ========== 3. FETCH TWELVE DATA ==========
async function fetchTwelveData(symbol, interval, limit = 80) {
    const apiKey = process.env.TWELVEDATA_KEY;
    if (!apiKey) {
        console.log('⚠️ ไม่มี Twelve Data API key');
        return null;
    }
    
    const url = `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=${interval}&outputsize=${limit}&apikey=${apiKey}`;
    
    try {
        const res = await fetch(url);
        const data = await res.json();
        
        if (!data.values || data.values.length === 0) {
            console.log(`⚠️ Twelve Data ไม่มีข้อมูล (${interval})`);
            return null;
        }
        
        twelveDataCalls++;
        console.log(`✅ Twelve Data (${interval}) | เรียกวันนี้: ${twelveDataCalls}/800`);
        
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

// ========== 4. MOCK DATA (FALLBACK) ==========
function generateMockData() {
    const data = [];
    let price = 2650;
    for (let i = 0; i < 80; i++) {
        const change = (Math.random() - 0.5) * 8;
        const open = price;
        const close = price + change;
        data.push({
            open: parseFloat(open.toFixed(2)),
            high: parseFloat((Math.max(open, close) + Math.random() * 4).toFixed(2)),
            low: parseFloat((Math.min(open, close) - Math.random() * 4).toFixed(2)),
            close: parseFloat(close.toFixed(2))
        });
        price = close;
    }
    return data;
}

// ========== 5. FETCH WITH FALLBACK ==========
async function fetchWithFallback(interval) {
    resetDailyCounter();
    
    let data = await fetchTwelveData('XAU/USD', interval, 80);
    if (data) return data;
    
    console.log(`⚠️ ใช้ Mock Data (${interval})`);
    return generateMockData();
}

// ========== 6. MAIN ENDPOINT ==========
app.get('/api/market', async (req, res) => {
    const now = Date.now();
    
    // ใช้ Cache ถ้ายังไม่หมดอายุ
    if (cache.M5 && (now - cache.timestamp) < CACHE_TTL) {
        console.log(`📦 ใช้ Cache (อายุ ${Math.round((now - cache.timestamp)/1000)} วินาที)`);
        return res.json({
            M5: cache.M5,
            M15: cache.M15,
            H1: cache.H1,
            cached: true,
            usage: { twelveData: twelveDataCalls }
        });
    }
    
    console.log('📡 เรียก API จริง...');
    
    try {
        const [M5, M15, H1] = await Promise.all([
            fetchWithFallback('5min'),
            fetchWithFallback('15min'),
            fetchWithFallback('1h')
        ]);
        
        cache = { M5, M15, H1, timestamp: now };
        
        res.json({
            M5, M15, H1,
            cached: false,
            usage: { twelveData: twelveDataCalls }
        });
        
    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            error: 'API ล่ม',
            M5: generateMockData(),
            M15: generateMockData(),
            H1: generateMockData(),
            isMock: true
        });
    }
});

// ========== 7. HEALTH CHECK ==========
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        cacheAge: cache.timestamp ? Math.round((Date.now() - cache.timestamp)/1000) : 0,
        apiUsage: { twelveData: `${twelveDataCalls}/800` },
        twelveDataKey: !!process.env.TWELVEDATA_KEY
    });
});

// ========== 8. START SERVER ==========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════╗
║   ✅ TWELVE DATA BACKEND READY            ║
║   🚀 http://localhost:${PORT}              ║
║   📡 Twelve Data: ${process.env.TWELVEDATA_KEY ? '✅' : '❌'}
║   ⏱️  Cache TTL: ${CACHE_TTL/1000} วินาที     ║
║   🎯 ใช้ API ตัวเดียว เสถียรยิ่งขึ้น        ║
╚════════════════════════════════════════════╝
    `);
});