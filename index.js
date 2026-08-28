const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const express = require('express');
const axios = require('axios');
const { JsonDB, Config } = require('node-json-db');

const db = new JsonDB(new Config("database", true, false, '/'));
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const TOKEN_BOT = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const ADMIN_CHANNEL_ID = process.env.ADMIN_CHANNEL_ID;
const OWNER_ID = process.env.OWNER_ID || "";

// API Keys
const SHRTFLY_API_KEY = process.env.SHRTFLY_API_KEY || "27ec1b82df0ebcd873cfdaf23204be70";
const SHRINKME_API_KEY = process.env.SHRINKME_API_KEY || "bbfe266096d2604965ff23d654e8c3dc6d6c5d35";
const OCTOLINKZ_API_KEY = process.env.OCTOLINKZ_API_KEY || "c29d86aeeebb654a71cf856db9955ac94ec09385";

const SO_XU_THUONG = 100;
const GIOI_HAN_MAC_DINH = 3;
const usedTokens = new Set();
const pendingCaptchas = new Map();

// Helpers
async function getXu(id) { try { return await db.getData(`/xu/${id}`) || 0; } catch { return 0; } }
async function addXu(id, amt) { const t = (await getXu(id)) + amt; await db.push(`/xu/${id}`, t); return t; }
async function getLimit(id) { try { return await db.getData(`/limit/${id}`) || GIOI_HAN_MAC_DINH; } catch { return GIOI_HAN_MAC_DINH; } }
async function setLimit(id, max) { await db.push(`/limit/${id}`, max); }

async function getLinkHistory(id, linkType) {
    try {
        const h = await db.getData(`/history_${linkType}/${id}`) || [], now = Date.now();
        const valid = h.filter(t => (now - t) < 86400000);
        await db.push(`/history_${linkType}/${id}`, valid); 
        return valid;
    } catch { return []; }
}

async function checkIsAdmin(member, userId) {
    if (userId === OWNER_ID) return true;
    if (member && member.permissions?.has(PermissionFlagsBits.ManageGuild)) return true;
    try {
        const admins = await db.getData('/admins') || [];
        return admins.includes(userId);
    } catch { return false; }
}

// BƯỚC 1: TRANG ĐÍCH XÁC MINH CAPTCHA
app.get('/verify-success', async (req, res) => {
    const { userid: id, token, type: linkType } = req.query;

    if (!id || !token || !linkType) return res.send('<h2>❌ Lỗi: Đường dẫn không hợp lệ!</h2>');
    if (usedTokens.has(token)) return res.send('<h2>⚠️ Lỗi: Link này đã được xác nhận trước đó!</h2>');

    const maxL = await getLimit(id);
    const history = await getLinkHistory(id, linkType);
    if (history.length >= maxL) return res.send(`<h2>⚠️ Hết lượt: Bạn đã hết lượt vượt link hôm nay (${history.length}/${maxL})!</h2>`);

    const captchaCode = Math.floor(1000 + Math.random() * 9000).toString();
    pendingCaptchas.set(token, captchaCode);

    res.send(`
        <!DOCTYPE html>
        <html lang="vi">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Xác minh nhận thưởng</title>
            <style>
                body { font-family: Arial, sans-serif; background: #0f172a; color: #fff; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
                .card { background: #1e293b; padding: 30px; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.3); text-align: center; width: 320px; }
                .captcha-box { background: #334155; font-size: 28px; font-weight: bold; letter-spacing: 6px; padding: 10px; border-radius: 8px; margin: 15px 0; color: #38bdf8; user-select: none; }
                input { width: 90%; padding: 12px; border: none; border-radius: 6px; text-align: center; font-size: 18px; margin-bottom: 15px; outline: none; }
                button { width: 100%; padding: 12px; background: #22c55e; color: #fff; border: none; border-radius: 6px; font-size: 16px; font-weight: bold; cursor: pointer; transition: 0.2s; }
                button:hover { background: #16a34a; }
            </style>
        </head>
        <body>
            <div class="card">
                <h2>🤖 Xác minh Captcha</h2>
                <p style="color:#94a3b8; font-size:14px;">Nhập mã bên dưới để hoàn tất:</p>
                <div class="captcha-box">${captchaCode}</div>
                <form action="/submit-captcha" method="POST">
                    <input type="hidden" name="userid" value="${id}">
                    <input type="hidden" name="token" value="${token}">
                    <input type="hidden" name="type" value="${linkType}">
                    <input type="text" name="captcha" placeholder="Nhập 4 số ở trên" maxlength="4" required autocomplete="off">
                    <button type="submit">XÁC NHẬN HOÀN TẤT</button>
                </form>
            </div>
        </body>
        </html>
    `);
});

// BƯỚC 2: XÁC NHẬN CAPTCHA -> THÔNG BÁO ADMIN (KHÔNG CỘNG XU TỰ ĐỘNG)
app.post('/submit-captcha', async (req, res) => {
    const { userid: id, token, type: linkType, captcha } = req.body;
    const realCaptcha = pendingCaptchas.get(token);

    if (!token || !realCaptcha || captcha !== realCaptcha) {
        return res.send(`
            <div style="text-align:center;padding:50px;font-family:sans-serif;">
                <h1 style="color:#ef4444;">❌ Mã Captcha không chính xác!</h1>
                <a href="javascript:history.back()" style="padding:10px 20px;background:#3b82f6;color:#fff;text-decoration:none;border-radius:6px;">Thử lại</a>
            </div>
        `);
    }

    if (usedTokens.has(token)) return res.send('<h2 style="text-align:center;margin-top:50px;">⚠️ Link này đã được xác nhận rồi!</h2>');

    let typeName = 'Shrtfly';
    if (linkType === 'shrinkme') typeName = 'Shrinkme.io';
    if (linkType === 'octolinkz') typeName = 'Octolinkz';

    const maxL = await getLimit(id);
    const history = await getLinkHistory(id, linkType);

    if (history.length >= maxL) {
        return res.send(`<h2 style="text-align:center;margin-top:50px;">⚠️ Bạn đã hết lượt vượt link ${typeName} hôm nay!</h2>`);
    }

    usedTokens.add(token);
    pendingCaptchas.delete(token);
    history.push(Date.now());
    await db.push(`/history_${linkType}/${id}`, history);

    // Gửi thông báo về kênh Admin Discord
    try {
        const ch = await client.channels.fetch(ADMIN_CHANNEL_ID);
        if (ch) {
            const embed = new EmbedBuilder()
                .setTitle(`🔔 NGƯỜI DÙNG VƯỢT LINK & HOÀN THÀNH CAPTCHA!`)
                .setColor('Yellow')
                .addFields(
                    { name: '👤 Người dùng', value: `<@${id}>`, inline: true },
                    { name: '🔗 Loại link', value: typeName, inline: true },
                    { name: `📊 Lượt ${typeName} hôm nay`, value: `${history.length}/${maxL}`, inline: true },
                    { name: '⚠️ Trạng thái', value: 'Đã nhập đúng Captcha. Vui lòng kiểm tra và cộng xu bằng lệnh `/congxu`', inline: false }
                )
                .setTimestamp();
            await ch.send({ embeds: [embed] });
        }
    } catch (e) {}

    res.send(`
        <!DOCTYPE html>
        <html lang="vi">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Thành Công</title>
            <style>
                body { font-family: Arial, sans-serif; background: #0f172a; color: #fff; text-align: center; padding-top: 80px; }
                .box { background: #1e293b; display: inline-block; padding: 40px; border-radius: 12px; }
                h1 { color: #22c55e; }
                a { display: inline-block; margin-top: 15px; padding: 12px 24px; background: #5865F2; color: #fff; text-decoration: none; border-radius: 8px; font-weight: bold; }
            </style>
            <script>
                setTimeout(() => { window.location.href = "https://discord.com/channels/@me"; }, 2000);
            </script>
        </head>
        <body>
            <div class="box">
                <h1>🎉 XÁC MINH CAPTCHA THÀNH CÔNG!</h1>
                <p>Hệ thống đã ghi nhận và gửi thông báo về cho Admin.</p>
                <p style="color:#94a3b8; font-size: 14px;">Đang tự động chuyển hướng về Discord trong 2 giây...</p>
                <a href="https://discord.com/channels/@me">🚀 Mở Discord Ngay</a>
            </div>
        </body>
        </html>
    `);
});

app.get('/', (req, res) => res.send('Bot is running online!'));
app.listen(process.env.PORT || 3000);

// COMMANDS REGISTRATION
const commands = [
    new SlashCommandBuilder().setName('getlink').setDescription('Lấy link vượt quảng cáo nhận xu'),
    new SlashCommandBuilder().setName('xemxu').setDescription('Xem số xu của bản thân hoặc người khác')
        .addUserOption(o => o.setName('user').setDescription('Thành viên').setRequired(false)),
    new SlashCommandBuilder().setName('doithuong').setDescription('Đổi xu lấy phần thưởng')
        .addStringOption(o => o.setName('tenqua').setDescription('Tên món quà').setRequired(true))
        .addIntegerOption(o => o.setName('giazxu').setDescription('Số xu cần đổi').setRequired(true)),
    new SlashCommandBuilder().setName('congxu').setDescription('[ADMIN] Cộng xu')
        .addUserOption(o => o.setName('user').setDescription('Thành viên').setRequired(true))
        .addIntegerOption(o => o.setName('soxu').setDescription('Số xu cộng').setRequired(true)),
    new SlashCommandBuilder().setName('truxu').setDescription('[ADMIN] Trừ xu')
        .addUserOption(o => o.setName('user').setDescription('Thành viên').setRequired(true))
        .addIntegerOption(o => o.setName('soxu').setDescription('Số xu trừ').setRequired(true)),
    new SlashCommandBuilder().setName('setgioihan').setDescription('[ADMIN] Set giới hạn/ngày')
        .addUserOption(o => o.setName('user').setDescription('Thành viên').setRequired(true))
        .addIntegerOption(o => o.setName('soluot').setDescription('Số lượt').setRequired(true)),
    new SlashCommandBuilder().setName('themadmin').setDescription('[ADMIN] Thêm Admin')
        .addUserOption(o => o.setName('user').setDescription('Thành viên').setRequired(true)),
    new SlashCommandBuilder().setName('xoadmin').setDescription('[ADMIN] Xóa Admin')
        .addUserOption(o => o.setName('user').setDescription('Thành viên').setRequired(true))
];

client.on('ready', async () => {
    const rest = new REST({ version: '10' }).setToken(TOKEN_BOT);
    try { 
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands }); 
        console.log(`Bot Online & Dang ky slash commands thanh cong: ${client.user.tag}`);
    } catch (e) {
        console.error("Loi dang ky Slash Commands:", e);
    }
});

// INTERACTION HANDLER
client.on('interactionCreate', async i => {
    if (!i.isChatInputCommand()) return;

    // PHẢN HỒI LẬP TỨC CHO DISCORD TRÁNH TIMEOUT 3 GiÂY
    try {
        await i.deferReply({ flags: 64 });
    } catch (err) {
        console.error("Loi deferReply:", err);
        return;
    }

    const id = i.user.id;
    const isAdmin = await checkIsAdmin(i.member, id);

    if (i.commandName === 'getlink') {
        // Thực hiện xử lý bất đồng bộ
        setImmediate(async () => {
            try {
                const maxL = await getLimit(id);
                const [hS, hSM, hOCT] = await Promise.all([
                    getLinkHistory(id, 'shrtfly'),
                    getLinkHistory(id, 'shrinkme'),
                    getLinkHistory(id, 'octolinkz')
                ]);

                const remS = Math.max(0, maxL - hS.length);
                const remSM = Math.max(0, maxL - hSM.length);
                const remOCT = Math.max(0, maxL - hOCT.length);

                if (remS <= 0 && remSM <= 0 && remOCT <= 0) {
                    return await i.editReply(`❌ Bạn đã dùng hết lượt vượt link hôm nay (${maxL}/${maxL})!`);
                }

                const tS = `${Date.now()}_s_${Math.random().toString(36).substr(2, 5)}`;
                const tSM = `${Date.now()}_sm_${Math.random().toString(36).substr(2, 5)}`;
                const tOCT = `${Date.now()}_oct_${Math.random().toString(36).substr(2, 5)}`;

                const renderUrl = process.env.RENDER_EXTERNAL_URL || "https://your-app.onrender.com";
                const targetS = `${renderUrl}/verify-success?userid=${id}&token=${tS}&type=shrtfly`;
                const targetSM = `${renderUrl}/verify-success?userid=${id}&token=${tSM}&type=shrinkme`;
                const targetOCT = `${renderUrl}/verify-success?userid=${id}&token=${tOCT}&type=octolinkz`;

                const axiosConfig = { timeout: 3500 };

                const [resS, resSM, resOCT] = await Promise.allSettled([
                    remS > 0 ? axios.get(`https://shrtfly.com/api?api=${SHRTFLY_API_KEY}&type=1&url=${encodeURIComponent(targetS)}&format=json`, axiosConfig) : null,
                    remSM > 0 ? axios.get(`https://shrinkme.io/api?api=${SHRINKME_API_KEY}&url=${encodeURIComponent(targetSM)}`, axiosConfig) : null,
                    remOCT > 0 ? axios.get(`https://octolinkz.com/api?api=${OCTOLINKZ_API_KEY}&url=${encodeURIComponent(targetOCT)}`, axiosConfig) : null
                ]);

                let lS = '🚫 *Hết lượt*', lSM = '🚫 *Hết lượt*', lOCT = '🚫 *Hết lượt*';

                if (remS > 0) {
                    if (resS.status === 'fulfilled' && resS.value?.data) {
                        const u = resS.value.data.shortenedUrl || resS.value.data.url || resS.value.data.result?.shorten_url;
                        lS = u ? `<${u}>` : 'Lỗi API Shrtfly';
                    } else lS = 'Lỗi kết nối Shrtfly';
                }

                if (remSM > 0) {
                    if (resSM.status === 'fulfilled' && resSM.value?.data) {
                        const u = resSM.value.data.shortenedUrl || resSM.value.data.shorten_url || resSM.value.data.url;
                        lSM = u ? `<${u}>` : 'Lỗi API Shrinkme';
                    } else lSM = 'Lỗi kết nối Shrinkme';
                }

                if (remOCT > 0) {
                    if (resOCT.status === 'fulfilled' && resOCT.value?.data) {
                        const u = resOCT.value.data.shortenedUrl || resOCT.value.data.shorten_url || resOCT.value.data.url;
                        lOCT = u ? `<${u}>` : 'Lỗi API Octolinkz';
                    } else lOCT = 'Lỗi kết nối Octolinkz';
                }

                const msg = `🔗 **DANH SÁCH LINK VƯỢT QC NGẪU NHIÊN (+${SO_XU_THUONG} xu/lần):**\n\n` +
                            `1️⃣ **Link Shrtfly** *(Còn ${remS}/${maxL} lượt)*:\n${lS}\n\n` +
                            `2️⃣ **Link Shrinkme.io** *(Còn ${remSM}/${maxL} lượt)*:\n${lSM}\n\n` +
                            `3️⃣ **Link Octolinkz** *(Còn ${remOCT}/${maxL} lượt)*:\n${lOCT}`;

                await i.editReply(msg);
            } catch (err) {
                console.error("Loi trong getlink handler:", err);
                await i.editReply('❌ Đã xảy ra lỗi khi tạo link, vui lòng thử lại!').catch(() => {});
            }
        });
    }

    if (i.commandName === 'xemxu') {
        setImmediate(async () => {
            const targetUser = i.options.getUser('user');

            // Kiểm tra: Nếu xem xu người khác mà không phải Admin/Mod thì chặn
            if (targetUser && targetUser.id !== i.user.id && !isAdmin) {
                return await i.editReply('❌ Bạn không có quyền xem số xu của người khác!');
            }

            const userToCheck = targetUser || i.user;
            const xu = await getXu(userToCheck.id);
            const maxL = await getLimit(userToCheck.id);
            const [hS, hSM, hOCT] = await Promise.all([
                getLinkHistory(userToCheck.id, 'shrtfly'),
                getLinkHistory(userToCheck.id, 'shrinkme'),
                getLinkHistory(userToCheck.id, 'octolinkz')
            ]);
            
            const remS = Math.max(0, maxL - hS.length);
            const remSM = Math.max(0, maxL - hSM.length);
            const remOCT = Math.max(0, maxL - hOCT.length);

            if (userToCheck.id === i.user.id) {
                await i.editReply(`💰 Bạn có **${xu} xu**!\n📊 Lượt còn hôm nay: **Shrtfly (${remS}/${maxL})** | **Shrinkme (${remSM}/${maxL})** | **Octolinkz (${remOCT}/${maxL})**.`);
            } else {
                await i.editReply(`💰 Thành viên <@${userToCheck.id}> có **${xu} xu** (Shrtfly: ${remS}/${maxL} | Shrinkme: ${remSM}/${maxL} | Octolinkz: ${remOCT}/${maxL}).`);
            }
        });
    }

    if (i.commandName === 'doithuong') {
        setImmediate(async () => {
            const q = i.options.getString('tenqua'), g = i.options.getInteger('giazxu'), xu = await getXu(id);
            if (xu < g) return await i.editReply(`❌ Không đủ xu! Bạn có **${xu} xu**, cần **${g} xu**.`);
            const remainder = await addXu(id, -g);
            await i.editReply(`✅ Đã gửi yêu cầu đổi **"${q}"** (${g} xu). Còn lại: **${remainder} xu**.`);
            try {
                const ch = await client.channels.fetch(ADMIN_CHANNEL_ID);
                if (ch) ch.send({ embeds: [new EmbedBuilder().setTitle('🎁 YÊU CẦU ĐỔI THƯỞNG').addFields({name:'Người đổi',value:`<@${id}>`},{name:'Tên quà',value:q},{name:'Xu trừ',value:`-${g} xu`}).setTimestamp()] });
            } catch {}
        });
    }

    if (['congxu', 'truxu', 'setgioihan', 'themadmin', 'xoadmin'].includes(i.commandName)) {
        setImmediate(async () => {
            if (!isAdmin) return await i.editReply('❌ Bạn không có quyền Admin/Mod!');

            if (i.commandName === 'congxu') {
                const u = i.options.getUser('user'), s = i.options.getInteger('soxu');
                const res = await addXu(u.id, s);
                await i.editReply(`🛠️ Admin <@${id}> đã cộng **${s} xu** cho <@${u.id}>. Ví: **${res} xu**.`);
            }

            if (i.commandName === 'truxu') {
                const u = i.options.getUser('user'), s = i.options.getInteger('soxu');
                const res = await addXu(u.id, -s);
                await i.editReply(`🛠️ Admin <@${id}> đã trừ **${s} xu** của <@${u.id}>. Ví: **${res} xu**.`);
            }

            if (i.commandName === 'setgioihan') {
                const u = i.options.getUser('user'), l = i.options.getInteger('soluot');
                await setLimit(u.id, l);
                await i.editReply(`🛠️ Admin <@${id}> đã set giới hạn vượt cho <@${u.id}> thành **${l} lượt/ngày**.`);
            }

            if (i.commandName === 'themadmin') {
                const u = i.options.getUser('user');
                let admins = [];
                try { admins = await db.getData('/admins') || []; } catch {}
                if (!admins.includes(u.id)) {
                    admins.push(u.id);
                    await db.push('/admins', admins);
                    await i.editReply(`👑 Đã phong quyền Admin/Mod cho <@${u.id}>!`);
                } else {
                    await i.editReply(`⚠️ <@${u.id}> đã là Admin/Mod rồi!`);
                }
            }

            if (i.commandName === 'xoadmin') {
                const u = i.options.getUser('user');
                let admins = [];
                try { admins = await db.getData('/admins') || []; } catch {}
                admins = admins.filter(a => a !== u.id);
                await db.push('/admins', admins);
                await i.editReply(`🗑️ Đã gỡ quyền Admin/Mod của <@${u.id}>.`);
            }
        });
    }
});

client.login(TOKEN_BOT);
