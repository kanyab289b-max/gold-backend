const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());

// ========== API KEYS ==========
const FINNHUB_KEY = process.env.FINNHUB_KEY || 'd7m7ncpr01qk7lvvbr80d7m7ncpr01qk7lvvbr8g';
const TWELVE_KEY = process.env.TWELVEDATA_KEY;

// ========== CACHE SYSTEM ==========
let cache = { M5: null, M15: null, H1: null, timestamp: 0 };
const CACHE_TTL = 30000; // 30 วินาที

// ========== USAGE COUNTER ==========
let finnhubCalls = 0;
let twelveDataCalls = 0;
let lastReset = Date.now();

function resetDailyCounter() {
    const now = Date.now();
    if (now - lastReset > 86400000) {
        finnhubCalls = 0;
        twelveDataCalls = 0;
        lastReset = now;
        console.log('🔄 รีเซ็ต API counter เรียบร้อย');
    }
}

// ========== 1. FINNHUB (PRIMARY) ==========
async function fetchFinnhub(symbol, resolution, limit = 80) {
    const now = Math.floor(Date.now() / 1000);
    const from = now - (limit * 60 * (resolution === '5' ? 5 : resolution === '15' ? 15 : 60));
    const url = `https://finnhub.io/api/v1/forex/candle?symbol=${symbol}&resolution=${resolution}&from=${from}&to=${now}&token=${FINNHUB_KEY}`;
    
    try {
        const res = await fetch(url);
        const data = await res.json();
        if (!data.c || data.s === 'no_data') throw new Error('No data');
        
        finnhubCalls++;
        console.log(`✅ Finnhub (${resolution}) | เรียกวันนี้: ${finnhubCalls}/60`);
        
        const ohlc = [];
        for (let i = 0; i < data.c.length; i++) {
            ohlc.push({
                open: data.o[i],
                high: data.h[i],
                low: data.l[i],
                close: data.c[i],
                time: new Date(data.t[i] * 1000).toISOString()
            });
        }
        return ohlc.reverse();
    } catch (error) {
        console.log(`⚠️ Finnhub failed (${resolution})`);
        return null;
    }
}

// ========== 2. TWELVE DATA (FALLBACK) ==========
async function fetchTwelveData(interval, limit = 80) {
    if (!TWELVE_KEY) return null;
    
    const url = `https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=${interval}&outputsize=${limit}&apikey=${TWELVE_KEY}`;
    
    try {
        const res = await fetch(url);
        const data = await res.json();
        if (!data.values || data.values.length === 0) throw new Error('No data');
        
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
        console.log(`⚠️ Twelve Data failed (${interval})`);
        return null;
    }
}

// ========== 3. MOCK DATA (FINAL FALLBACK) ==========
function generateMockData() {
    const data = [];
    let price = 2650;
    for (let i = 0; i < 80; i++) {
        const change = (Math.random() - 0.5) * 8;
        const close = price + change;
        data.push({
            open: parseFloat(price.toFixed(2)),
            high: parseFloat((Math.max(price, close) + Math.random() * 4).toFixed(2)),
            low: parseFloat((Math.min(price, close) - Math.random() * 4).toFixed(2)),
            close: parseFloat(close.toFixed(2))
        });
        price = close;
    }
    return data;
}

// ========== 4. FETCH WITH FALLBACK (Finnhub → Twelve → Mock) ==========
async function fetchWithFallback(finnhubRes, twelveInterval) {
    resetDailyCounter();
    
    // 1. Finnhub
    let data = await fetchFinnhub('OANDA:XAUUSD', finnhubRes);
    if (data) return data;
    
    // 2. Twelve Data
    data = await fetchTwelveData(twelveInterval);
    if (data) return data;
    
    // 3. Mock
    console.log(`⚠️ ใช้ Mock Data (${twelveInterval})`);
    return generateMockData();
}

// ========== 5. MAIN ENDPOINT ==========
app.get('/api/market', async (req, res) => {
    const now = Date.now();
    
    if (cache.M5 && now - cache.timestamp < CACHE_TTL) {
        console.log(`📦 ใช้ Cache (อายุ ${Math.round((now - cache.timestamp)/1000)} วินาที)`);
        return res.json({
            M5: cache.M5,
            M15: cache.M15,
            H1: cache.H1,
            cached: true,
            usage: { finnhub: finnhubCalls, twelveData: twelveDataCalls }
        });
    }
    
    console.log('📡 เรียก API จริง...');
    
    try {
        const [M5, M15, H1] = await Promise.all([
            fetchWithFallback('5', '5min'),
            fetchWithFallback('15', '15min'),
            fetchWithFallback('60', '1h')
        ]);
        
        cache = { M5, M15, H1, timestamp: now };
        
        res.json({
            M5, M15, H1,
            cached: false,
            source: 'finnhub-primary',
            usage: { finnhub: finnhubCalls, twelveData: twelveDataCalls }
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

// ========== 6. HEALTH CHECK ==========
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        cacheAge: cache.timestamp ? Math.round((Date.now() - cache.timestamp)/1000) : 0,
        apiUsage: {
            finnhub: `${finnhubCalls}/60`,
            twelveData: `${twelveDataCalls}/800`
        },
        finnhubKey: !!FINNHUB_KEY,
        twelveDataKey: !!TWELVE_KEY
    });
});

// ========== 7. START SERVER ==========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║   ✅ MARKET API (FINNHUB PRIMARY + TWELVE FALLBACK)         ║
║   🚀 http://localhost:${PORT}/api/market                     ║
║   📡 Finnhub: ${FINNHUB_KEY ? '✅' : '❌'}     Twelve Data: ${TWELVE_KEY ? '✅' : '❌'}
║   ⏱️  Cache TTL: ${CACHE_TTL/1000} วินาที                  ║
║   🔄 Finnhub → Twelve Data → Mock (Auto Fallback)          ║
╚══════════════════════════════════════════════════════════════╝
    `);
});