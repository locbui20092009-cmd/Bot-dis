const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder, PermissionFlagsBits } = require('/opt/render/project/src/node_modules/discord.js');
const express = require('/opt/render/project/src/node_modules/express');
const axios = require('/opt/render/project/src/node_modules/axios');
const { JsonDB, Config } = require('/opt/render/project/src/node_modules/node-json-db');

const db = new JsonDB(new Config("database", true, false, '/'));
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const app = express();

const TOKEN_BOT = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const ADMIN_CHANNEL_ID = process.env.ADMIN_CHANNEL_ID;
const OWNER_ID = process.env.OWNER_ID || ""; // ID Discord của bạn (Chủ sở hữu)

const SO_XU_THUONG = 100;
const GIOI_HAN_MAC_DINH = 3;
const usedTokens = new Set();

// Helper Functions cho Database
async function getXu(id) { try { return await db.getData(`/xu/${id}`) || 0; } catch { return 0; } }
async function addXu(id, amt) { const t = (await getXu(id)) + amt; await db.push(`/xu/${id}`, t); return t; }
async function getLimit(id) { try { return await db.getData(`/limit/${id}`) || GIOI_HAN_MAC_DINH; } catch { return GIOI_HAN_MAC_DINH; } }
async function setLimit(id, max) { await db.push(`/limit/${id}`, max); }

async function getHistory(id) {
    try {
        const h = await db.getData(`/history/${id}`) || [], now = Date.now();
        const valid = h.filter(t => (now - t) < 86400000);
        await db.push(`/history/${id}`, valid); 
        return valid;
    } catch { return []; }
}

// Kiểm tra quyền Admin/Mod
async function checkIsAdmin(member, userId) {
    if (userId === OWNER_ID) return true;
    if (member && member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
    try {
        const admins = await db.getData('/admins') || [];
        return admins.includes(userId);
    } catch {
        return false;
    }
}

// Express Web Server xử lý khi Vượt Link thành công
app.get('/verify-success', async (req, res) => {
    const { userid: id, token } = req.query;
    const sendWeb = (title, msg, ok = false) => res.send(`
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <div style="text-align:center;padding:40px;font-family:sans-serif;">
            <h1 style="color:${ok?'#2ecc71':'#e74c3c'}">${title}</h1><p>${msg}</p>
            ${ok ? `<p><b>+${SO_XU_THUONG} Xu</b> đã được cộng vào ví của bạn!</p>` : ''}
            <a href="https://discord.com/channels/@me" style="display:inline-block;padding:10px 20px;background:#5865F2;color:#fff;text-decoration:none;border-radius:8px;margin-top:10px;">🚀 Quay lại Discord</a>
        </div>
        <script>history.pushState(null,null,location.href);window.onpopstate=()=>history.go(1);</script>
    `);

    if (!id || !token) return sendWeb('Lỗi', 'Đường dẫn không hợp lệ!');
    if (usedTokens.has(token)) return sendWeb('⚠️ Lỗi', 'Link xác thực này đã được sử dụng!');
    
    const maxL = await getLimit(id), history = await getHistory(id);
    if (history.length >= maxL) return sendWeb('⚠️ Hết lượt', `Bạn đã đạt giới hạn ${history.length}/${maxL} lượt trong 24 giờ!`);

    usedTokens.add(token);
    history.push(Date.now());
    await db.push(`/history/${id}`, history);

    try {
        const xuMoi = await addXu(id, SO_XU_THUONG);
        const ch = await client.channels.fetch(ADMIN_CHANNEL_ID);
        if (ch) {
            const embed = new EmbedBuilder()
                .setTitle('🎉 VƯỢT LINK THÀNH CÔNG!')
                .setColor('Green')
                .addFields(
                    { name: '👤 Người dùng', value: `<@${id}>`, inline: true },
                    { name: '🪙 Thưởng', value: `+${SO_XU_THUONG} xu`, inline: true },
                    { name: '💰 Ví hiện tại', value: `${xuMoi} xu`, inline: true },
                    { name: '📊 Lượt hôm nay', value: `${history.length}/${maxL}`, inline: true }
                )
                .setTimestamp();
            await ch.send({ embeds: [embed] });
        }
        sendWeb('🎉 Thành Công!', 'Xác nhận vượt link thành công!', true);
    } catch (e) { res.status(500).send('Lỗi máy chủ'); }
});

app.get('/', (req, res) => res.send('Bot is running online!'));
app.listen(process.env.PORT || 3000);

// Đăng ký danh sách Slash Commands
const commands = [
    new SlashCommandBuilder().setName('getlink').setDescription('Lấy link vượt quảng cáo nhận xu'),
    
    new SlashCommandBuilder().setName('xemxu').setDescription('Xem số xu hiện tại của bản thân hoặc người khác')
        .addUserOption(o => o.setName('user').setDescription('Chọn người muốn xem xu (để trống nếu xem của mình)').setRequired(false)),
    
    new SlashCommandBuilder().setName('doithuong').setDescription('Đổi xu lấy phần thưởng')
        .addStringOption(o => o.setName('tenqua').setDescription('Tên món quà').setRequired(true))
        .addIntegerOption(o => o.setName('giazxu').setDescription('Số xu cần đổi').setRequired(true)),
    
    new SlashCommandBuilder().setName('congxu').setDescription('[ADMIN/MOD] Cộng xu cho thành viên')
        .addUserOption(o => o.setName('user').setDescription('Thành viên').setRequired(true))
        .addIntegerOption(o => o.setName('soxu').setDescription('Số xu cộng').setRequired(true)),
    
    new SlashCommandBuilder().setName('truxu').setDescription('[ADMIN/MOD] Trừ xu của thành viên')
        .addUserOption(o => o.setName('user').setDescription('Thành viên').setRequired(true))
        .addIntegerOption(o => o.setName('soxu').setDescription('Số xu trừ').setRequired(true)),
    
    new SlashCommandBuilder().setName('setgioihan').setDescription('[ADMIN/MOD] Thiết lập giới hạn lượt vượt/ngày cho thành viên')
        .addUserOption(o => o.setName('user').setDescription('Thành viên').setRequired(true))
        .addIntegerOption(o => o.setName('soluot').setDescription('Số lượt tối đa').setRequired(true)),

    new SlashCommandBuilder().setName('themadmin').setDescription('[CHỦ BOT/ADMIN] Thêm người phụ quản lý Bot')
        .addUserOption(o => o.setName('user').setDescription('Thành viên muốn cấp quyền Admin/Mod').setRequired(true)),

    new SlashCommandBuilder().setName('xoadmin').setDescription('[CHỦ BOT/ADMIN] Xóa quyền quản lý Bot của ai đó')
        .addUserOption(o => o.setName('user').setDescription('Thành viên muốn gỡ quyền').setRequired(true))
];

client.on('ready', async () => {
    const rest = new REST({ version: '10' }).setToken(TOKEN_BOT);
    try { await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands }); } catch (e) {}
    console.log(`Bot Discord đã sẵn sàng với tên: ${client.user.tag}`);
});

// Xử lý các lệnh Interaction
client.on('interactionCreate', async i => {
    if (!i.isChatInputCommand()) return;
    const id = i.user.id;
    const isAdmin = await checkIsAdmin(i.member, id);

    // 1. Lệnh Lấy Link Vượt
    if (i.commandName === 'getlink') {
        await i.deferReply({ ephemeral: true });
        const maxL = await getLimit(id), history = await getHistory(id);
        if (history.length >= maxL) return i.editReply(`❌ Bạn đã sử dụng hết **${history.length}/${maxL}** lượt vượt link hôm nay!`);

        const token = `${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        const target = `${process.env.RENDER_EXTERNAL_URL}/verify-success?userid=${id}&token=${token}`;
        let l1 = 'Lỗi kết nối', l2 = 'Lỗi kết nối';

        try { const r1 = await axios.get(`https://shrinkme.io/api?api=bbfe266096d2604965ff23d654e8c3dc6d6c5d35&url=${encodeURIComponent(target)}`); l1 = r1.data?.shortenedUrl || r1.data?.shorten_url || r1.data?.url || 'Lỗi'; } catch {}
        try { const r2 = await axios.get(`https://shrtfly.com/api?api=27ec1b82df0ebcd873cfdaf23204be70&type=1&url=${encodeURIComponent(target)}`); l2 = r2.data?.result?.shorten_url || r2.data?.shorten_url || r2.data?.url || 'Lỗi'; } catch {}

        await i.editReply(`🔗 **Chọn 1 trong các link dưới đây để vượt QC (Thưởng +${SO_XU_THUONG} xu):**\n1️⃣ **Shrinkme:** ${l1}\n2️⃣ **Shrtfly:** ${l2}\n📊 *Lượt hôm nay của bạn: ${history.length}/${maxL}*`);
    }

    // 2. Lệnh Xem Xu (Cho phép xem xu của bản thân hoặc người khác)
    if (i.commandName === 'xemxu') {
        const targetUser = i.options.getUser('user') || i.user;
        const xu = await getXu(targetUser.id);
        const maxL = await getLimit(targetUser.id);
        const history = await getHistory(targetUser.id);
        
        if (targetUser.id === i.user.id) {
            await i.reply({ content: `💰 Ví của bạn hiện có **${xu} xu**! Lượt vượt hôm nay: **${history.length}/${maxL}**.`, ephemeral: true });
        } else {
            await i.reply({ content: `💰 Thành viên <@${targetUser.id}> hiện có **${xu} xu** (Lượt vượt hôm nay: **${history.length}/${maxL}**).` });
        }
    }

    // 3. Lệnh Đổi Thưởng
    if (i.commandName === 'doithuong') {
        const q = i.options.getString('tenqua'), g = i.options.getInteger('giazxu'), xu = await getXu(id);
        if (xu < g) return i.reply({ content: `❌ Không đủ xu! Bạn có **${xu} xu**, cần **${g} xu** để đổi quà này.`, ephemeral: true });
        const remainder = await addXu(id, -g);
        await i.reply({ content: `✅ Đã gửi yêu cầu đổi quà **"${q}"** (${g} xu). Số xu còn lại: **${remainder} xu**.`, ephemeral: true });
        try {
            const ch = await client.channels.fetch(ADMIN_CHANNEL_ID);
            if (ch) ch.send({ embeds: [new EmbedBuilder().setTitle('🎁 YÊU CẦU ĐỔI THƯỞNG').addFields({name:'Người đổi',value:`<@${id}>`},{name:'Tên quà',value:q},{name:'Xu trừ',value:`-${g} xu`}).setTimestamp()] });
        } catch {}
    }

    // Các lệnh dành riêng cho Admin/Mod quản lý
    if (['congxu', 'truxu', 'setgioihan', 'themadmin', 'xoadmin'].includes(i.commandName)) {
        if (!isAdmin) {
            return i.reply({ content: '❌ Bạn không có quyền Admin/Mod để sử dụng lệnh quản trị này!', ephemeral: true });
        }

        if (i.commandName === 'congxu') {
            const u = i.options.getUser('user'), s = i.options.getInteger('soxu');
            const res = await addXu(u.id, s);
            await i.reply(`🛠️ Admin <@${id}> đã cộng **${s} xu** cho <@${u.id}>. Ví hiện tại: **${res} xu**.`);
        }

        if (i.commandName === 'truxu') {
            const u = i.options.getUser('user'), s = i.options.getInteger('soxu');
            const res = await addXu(u.id, -s);
            await i.reply(`🛠️ Admin <@${id}> đã trừ **${s} xu** của <@${u.id}>. Ví còn lại: **${res} xu**.`);
        }

        if (i.commandName === 'setgioihan') {
            const u = i.options.getUser('user'), l = i.options.getInteger('soluot');
            await setLimit(u.id, l);
            await i.reply(`🛠️ Admin <@${id}> đã chỉnh giới hạn vượt link của <@${u.id}> thành **${l} lượt/ngày**.`);
        }

        if (i.commandName === 'themadmin') {
            const u = i.options.getUser('user');
            let admins = [];
            try { admins = await db.getData('/admins') || []; } catch {}
            if (!admins.includes(u.id)) {
                admins.push(u.id);
                await db.push('/admins', admins);
                await i.reply(`👑 Đã phong quyền Admin/Mod cho <@${u.id}> thành công!`);
            } else {
                await i.reply({ content: `⚠️ <@${u.id}> đã là Admin/Mod rồi!`, ephemeral: true });
            }
        }

        if (i.commandName === 'xoadmin') {
            const u = i.options.getUser('user');
            let admins = [];
            try { admins = await db.getData('/admins') || []; } catch {}
            admins = admins.filter(a => a !== u.id);
            await db.push('/admins', admins);
            await i.reply(`🗑️ Đã gỡ quyền Admin/Mod của <@${u.id}>.`);
        }
    }
});

client.login(TOKEN_BOT);
