const { Client, Intents } = require('discord.js');
const express = require('express');
const axios = require('axios');
const { SpeechSynthesisVoice } = require('gtts-speech');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const random = require('random');

// Tải các biến môi trường
dotenv.config();

// Khởi tạo client Discord
const client = new Client({
    intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES],
});

const TOKEN = process.env.TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;  // Cung cấp CHANNEL_ID từ biến môi trường
const OWM_API_KEY = process.env.OWM_API_KEY;
const RAPID_API_KEY = process.env.RAPID_API_KEY;
const OCR_API_KEY = process.env.OCR_API_KEY;

// === Express keep-alive ===
const app = express();

app.get('/', (req, res) => {
    res.send('Bot is running!');
});

function keepAlive() {
    app.listen(8080, () => {
        console.log('Server is running on port 8080');
    });
}

// === OCR API (API cho nhận dạng chữ trong ảnh) ===
async function ocrSpaceFile(filePath, apiKey = OCR_API_KEY) {
    const formData = new FormData();
    formData.append('apikey', apiKey);
    formData.append('language', 'vie');
    formData.append('file', fs.createReadStream(filePath));

    try {
        const response = await axios.post('https://api.ocr.space/parse/image', formData, {
            headers: {
                ...formData.getHeaders(),
            }
        });

        const result = response.data;
        if (result.IsErroredOnProcessing) {
            throw new Error(result.ErrorMessage || "Unknown error");
        }
        return result.ParsedResults[0].ParsedText;
    } catch (error) {
        console.error('OCR Error:', error);
        return null;
    }
}

// === Chuyển văn bản thành giọng nói (TTS) ===
function textToSpeech(text, filename = 'tts_output.mp3') {
    const speech = new SpeechSynthesisVoice(text);
    speech.save(path.join(__dirname, filename), (err) => {
        if (err) {
            console.error("Error generating speech:", err);
        }
    });
}

// === Lấy thông tin thời tiết ===
async function getWeather(city) {
    try {
        const response = await axios.get(`https://api.openweathermap.org/data/2.5/weather`, {
            params: {
                q: city,
                appid: OWM_API_KEY,
                units: 'metric',
                lang: 'vi',
            },
        });
        const data = response.data;
        return `🌤 **Thời tiết tại ${city}**:\n` +
               `Trạng thái: ${data.weather[0].description}\n` +
               `Nhiệt độ: ${data.main.temp}°C\n` +
               `Độ ẩm: ${data.main.humidity}%\n` +
               `Gió: ${data.wind.speed} m/s`;
    } catch (error) {
        return '🚫 Không tìm thấy thông tin thời tiết cho thành phố này!';
    }
}

// === Nhắc nhở uống nước ====
const reminderList = [
    "💧 Nhớ uống nước đi nha, khát thì đừng nhớ bot nha!",
    "🤸 Đứng dậy vươn vai, cho máu lưu thông nào!",
    "🍵 Uống nước không chỉ là thói quen mà còn là phong cách sống!",
    "🚶 Dậy đi vòng vòng, bot đi chung nhé (nói cho vui thôi)!",
    "🫗 Đã đến giờ bot nhắc: Uống nước ngay!"
];

const usedReminders = [];

function pickReminder() {
    const remaining = reminderList.filter(reminder => !usedReminders.includes(reminder));
    if (remaining.length === 0) {
        usedReminders.length = 0;  // Reset used reminders
    }
    const reminder = random.choice(remaining);
    usedReminders.push(reminder);
    return reminder;
}

// === Gửi thông tin theo giờ ====
client.on('ready', () => {
    console.log(`✅ Bot đã đăng nhập: ${client.user.tag}`);
    setInterval(() => {
        const now = new Date();
        const hour = now.getHours();
        if (hour >= 7 && hour <= 18) {
            const channel = client.channels.cache.get(CHANNEL_ID);
            const reminder = pickReminder();
            channel.send(`${reminder} @everyone`);
        }
    }, 60 * 60 * 1000); // Mỗi giờ một lần
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const content = message.content.trim();

    if (content.startsWith('.tt')) {
        const city = content.slice(3).trim();
        if (city) {
            const weather = await getWeather(city);
            message.channel.send(weather);
        } else {
            message.channel.send('⚠️ Dùng: `.tt <tên địa danh>`');
        }
    } else if (content.startsWith('.help')) {
        message.channel.send(
            "📖 **Hướng dẫn sử dụng bot:**\n" +
            "1. `.tt <tên địa danh>` – Xem thời tiết.\n" +
            "2. Gửi link TikTok – Bot trả video xoá logo.\n" +
            "3. `.help` – Xem danh sách lệnh."
        );
    } else if (content.startsWith('.đ')) {
        message.channel.send("💧 Nhớ uống nước đi nha, khát thì đừng nhớ bot nha!");
    } else if (content.includes('tiktok.com')) {
        // Tích hợp TikTok logic (tương tự Python)
    }

    // Xử lý ảnh gửi lên
    if (message.attachments.size > 0) {
        for (const attachment of message.attachments.values()) {
            if (['png', 'jpg', 'jpeg', 'bmp', 'gif'].some(ext => attachment.filename.toLowerCase().endsWith(ext))) {
                // Tải ảnh về
                const imgPath = path.join(__dirname, `./temp_${attachment.id}_${attachment.filename}`);
                await attachment.download(imgPath);

                // Gửi lên OCR
                const text = await ocrSpaceFile(imgPath);

                if (text) {
                    // Tạo giọng nói từ text
                    const audioFile = textToSpeech(text);
                    if (audioFile) {
                        await message.channel.send(`📝 Nội dung chữ trong ảnh:\n\`\`\`\n${text}\n\`\`\``);
                        // Gửi file âm thanh
                        await message.channel.send({ files: [audioFile] });
                        fs.unlinkSync(audioFile);
                    } else {
                        await message.channel.send("⚠️ Lỗi khi tạo giọng nói!");
                    }
                } else {
                    await message.channel.send("⚠️ Bot không đọc được chữ trong ảnh!");
                }

                // Xoá ảnh tạm
                fs.unlinkSync(imgPath);
                break;
            }
        }
    }
});

// === Chạy bot Discord ===
keepAlive();
client.login(TOKEN);