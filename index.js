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
const OWNER_ID = process.env.OWNER_ID || "";
const SHRINKME_API_KEY = process.env.SHRINKME_API_KEY || "YOUR_SHRINKME_API_KEY";

const SO_XU_THUONG = 100;
const GIOI_HAN_MAC_DINH = 3; // Mặc định 3 lượt / loại link / 24h
const usedTokens = new Set();

// Helper Functions
async function getXu(id) { try { return await db.getData(`/xu/${id}`) || 0; } catch { return 0; } }
async function addXu(id, amt) { const t = (await getXu(id)) + amt; await db.push(`/xu/${id}`, t); return t; }
async function getLimit(id) { try { return await db.getData(`/limit/${id}`) || GIOI_HAN_MAC_DINH; } catch { return GIOI_HAN_MAC_DINH; } }
async function setLimit(id, max) { await db.push(`/limit/${id}`, max); }

// Lấy lịch sử vượt link của riêng từng loại link (shrtfly / shrinkme)
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
    if (member && member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
    try {
        const admins = await db.getData('/admins') || [];
        return admins.includes(userId);
    } catch {
        return false;
    }
}

// Xử lý khi Vượt Captcha + Vượt Link thành công
app.get('/verify-success', async (req, res) => {
    const { userid: id, token, type: linkType } = req.query;
    const typeName = linkType === 'shrtfly' ? 'Shrtfly' : 'Shrinkme.io';

    const sendWeb = (title, msg, ok = false) => res.send(`
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <div style="text-align:center;padding:40px;font-family:sans-serif;">
            <h1 style="color:${ok?'#2ecc71':'#e74c3c'}">${title}</h1><p>${msg}</p>
            ${ok ? `<p><b>+${SO_XU_THUONG} Xu</b> đã được cộng vào ví của bạn!</p>` : ''}
            <a href="https://discord.com/channels/@me" style="display:inline-block;padding:12px 24px;background:#5865F2;color:#fff;text-decoration:none;border-radius:8px;margin-top:15px;font-weight:bold;">🚀 Quay lại Discord</a>
        </div>
        <script>history.pushState(null,null,location.href);window.onpopstate=()=>history.go(1);</script>
    `);

    if (!id || !token || !linkType) return sendWeb('Lỗi', 'Đường dẫn không hợp lệ!');
    if (usedTokens.has(token)) return sendWeb('⚠️ Lỗi', 'Link xác thực này đã được sử dụng!');
    
    const maxL = await getLimit(id);
    const history = await getLinkHistory(id, linkType);
    if (history.length >= maxL) return sendWeb('⚠️ Hết lượt', `Bạn đã hết lượt vượt link ${typeName} hôm nay (${history.length}/${maxL})!`);

    usedTokens.add(token);
    history.push(Date.now());
    await db.push(`/history_${linkType}/${id}`, history);

    try {
        const xuMoi = await addXu(id, SO_XU_THUONG);
        const ch = await client.channels.fetch(ADMIN_CHANNEL_ID);
        if (ch) {
            const embed = new EmbedBuilder()
                .setTitle(`🎉 VƯỢT LINK ${typeName.toUpperCase()} THÀNH CÔNG!`)
                .setColor('Green')
                .addFields(
                    { name: '👤 Người dùng', value: `<@${id}>`, inline: true },
                    { name: '🪙 Thưởng', value: `+${SO_XU_THUONG} xu`, inline: true },
                    { name: '💰 Ví hiện tại', value: `${xuMoi} xu`, inline: true },
                    { name: `📊 Lượt ${typeName} hôm nay`, value: `${history.length}/${maxL}`, inline: true }
                )
                .setTimestamp();
            await ch.send({ embeds: [embed] });
        }
        sendWeb('🎉 Thành Công!', `Bạn đã xác minh Captcha & vượt link ${typeName} thành công!`, true);
    } catch (e) { res.status(500).send('Lỗi máy chủ'); }
});

app.get('/', (req, res) => res.send('Bot is running online!'));
app.listen(process.env.PORT || 3000);

// Danh sách Slash Commands
const commands = [
    new SlashCommandBuilder().setName('getlink').setDescription('Lấy link vượt quảng cáo nhận xu (Shrtfly & Shrinkme.io)'),
    
    new SlashCommandBuilder().setName('xemxu').setDescription('Xem số xu của bản thân hoặc người khác')
        .addUserOption(o => o.setName('user').setDescription('Chọn người muốn xem (để trống nếu xem của mình)').setRequired(false)),
    
    new SlashCommandBuilder().setName('doithuong').setDescription('Đổi xu lấy phần thưởng')
        .addStringOption(o => o.setName('tenqua').setDescription('Tên món quà').setRequired(true))
        .addIntegerOption(o => o.setName('giazxu').setDescription('Số xu cần đổi').setRequired(true)),
    
    new SlashCommandBuilder().setName('congxu').setDescription('[ADMIN/MOD] Cộng xu')
        .addUserOption(o => o.setName('user').setDescription('Thành viên').setRequired(true))
        .addIntegerOption(o => o.setName('soxu').setDescription('Số xu cộng').setRequired(true)),
    
    new SlashCommandBuilder().setName('truxu').setDescription('[ADMIN/MOD] Trừ xu')
        .addUserOption(o => o.setName('user').setDescription('Thành viên').setRequired(true))
        .addIntegerOption(o => o.setName('soxu').setDescription('Số xu trừ').setRequired(true)),
    
    new SlashCommandBuilder().setName('setgioihan').setDescription('[ADMIN/MOD] Set giới hạn lượt vượt/ngày')
        .addUserOption(o => o.setName('user').setDescription('Thành viên').setRequired(true))
        .addIntegerOption(o => o.setName('soluot').setDescription('Số lượt tối đa').setRequired(true)),

    new SlashCommandBuilder().setName('themadmin').setDescription('[CHỦ BOT/ADMIN] Thêm người phụ quản lý Bot')
        .addUserOption(o => o.setName('user').setDescription('Thành viên muốn cấp quyền').setRequired(true)),

    new SlashCommandBuilder().setName('xoadmin').setDescription('[CHỦ BOT/ADMIN] Xóa quyền Admin/Mod')
        .addUserOption(o => o.setName('user').setDescription('Thành viên muốn gỡ quyền').setRequired(true))
];

client.on('ready', async () => {
    const rest = new REST({ version: '10' }).setToken(TOKEN_BOT);
    try { await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands }); } catch (e) {}
    console.log(`Bot Discord đã sẵn sàng với tên: ${client.user.tag}`);
});

client.on('interactionCreate', async i => {
    if (!i.isChatInputCommand()) return;
    const id = i.user.id;
    const isAdmin = await checkIsAdmin(i.member, id);

    // 1. Lệnh Getlink
    if (i.commandName === 'getlink') {
        await i.deferReply({ ephemeral: true });
        const maxL = await getLimit(id);
        
        // Đếm lượt từng link
        const hShrtfly = await getLinkHistory(id, 'shrtfly');
        const hShrinkme = await getLinkHistory(id, 'shrinkme');

        const remShrtfly = Math.max(0, maxL - hShrtfly.length);
        const remShrinkme = Math.max(0, maxL - hShrinkme.length);

        if (remShrtfly <= 0 && remShrinkme <= 0) {
            return i.editReply(`❌ Bạn đã dùng hết lượt cho **cả 2 link** hôm nay (Shrtfly: 0/${maxL}, Shrinkme: 0/${maxL})! Vui lòng quay lại sau 24h.`);
        }

        // Tạo Token duy nhất cho lượt bấm
        const tokenShrtfly = `${Date.now()}_s_${Math.random().toString(36).substr(2, 6)}`;
        const tokenShrinkme = `${Date.now()}_sm_${Math.random().toString(36).substr(2, 6)}`;

        const targetShrtfly = `${process.env.RENDER_EXTERNAL_URL}/verify-success?userid=${id}&token=${tokenShrtfly}&type=shrtfly`;
        const targetShrinkme = `${process.env.RENDER_EXTERNAL_URL}/verify-success?userid=${id}&token=${tokenShrinkme}&type=shrinkme`;

        let lShrtfly = '❌ Hết lượt', lShrinkme = '❌ Hết lượt';

        // Tạo Link Shrtfly ngẫu nhiên hoàn toàn (Tạo alias ngẫu nhiên không đụng hàng)
        if (remShrtfly > 0) {
            try { 
                const randomAliasSF = `sf_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
                const apiShrtfly = `https://shrtfly.com/api?api=27ec1b82df0ebcd873cfdaf23204be70&url=${encodeURIComponent(targetShrtfly)}&alias=${randomAliasSF}`;
                
                const r = await axios.get(apiShrtfly); 
                lShrtfly = r.data?.result?.shorten_url || r.data?.shorten_url || r.data?.url || 'Lỗi link'; 
            } catch { lShrtfly = 'Lỗi kết nối'; }
        }

        // Tạo Link Shrinkme.io ngẫu nhiên hoàn toàn (Tạo alias ngẫu nhiên không đụng hàng)
        if (remShrinkme > 0) {
            try { 
                const randomAliasSM = `sm_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
                const apiShrinkme = `https://shrinkme.io/api?api=${SHRINKME_API_KEY}&url=${encodeURIComponent(targetShrinkme)}&alias=${randomAliasSM}`;
                
                const r = await axios.get(apiShrinkme); 
                lShrinkme = r.data?.shortenedUrl || r.data?.shorten_url || r.data?.url || 'Lỗi link'; 
            } catch { lShrinkme = 'Lỗi kết nối'; }
        }

        const msg = `🔗 **DANH SÁCH LINK VƯỢT QC NGẪU NHIÊN (+${SO_XU_THUONG} xu/lần):**\n\n` +
                    `1️⃣ **Link Shrtfly** *(Còn ${remShrtfly}/${maxL} lượt)*:\n${remShrtfly > 0 ? lShrtfly : '🚫 *Đã hết lượt hôm nay*'}\n\n` +
                    `2️⃣ **Link Shrinkme.io** *(Còn ${remShrinkme}/${maxL} lượt)*:\n${remShrinkme > 0 ? lShrinkme : '🚫 *Đã hết lượt hôm nay*'}`;

        await i.editReply(msg);
    }

    // 2. Lệnh Xem Xu
    if (i.commandName === 'xemxu') {
        const targetUser = i.options.getUser('user') || i.user;
        const xu = await getXu(targetUser.id);
        const maxL = await getLimit(targetUser.id);
        const hS = await getLinkHistory(targetUser.id, 'shrtfly');
        const hSM = await getLinkHistory(targetUser.id, 'shrinkme');
        
        const remS = Math.max(0, maxL - hS.length);
        const remSM = Math.max(0, maxL - hSM.length);

        if (targetUser.id === i.user.id) {
            await i.reply({ content: `💰 Bạn có **${xu} xu**!\n📊 Lượt còn hôm nay: **Shrtfly (${remS}/${maxL})** | **Shrinkme.io (${remSM}/${maxL})**.`, ephemeral: true });
        } else {
            await i.reply({ content: `💰 Thành viên <@${targetUser.id}> có **${xu} xu** (Lượt còn: Shrtfly ${remS}/${maxL} | Shrinkme.io ${remSM}/${maxL}).` });
        }
    }

    // 3. Lệnh Đổi Thưởng
    if (i.commandName === 'doithuong') {
        const q = i.options.getString('tenqua'), g = i.options.getInteger('giazxu'), xu = await getXu(id);
        if (xu < g) return i.reply({ content: `❌ Không đủ xu! Bạn có **${xu} xu**, cần **${g} xu**.`, ephemeral: true });
        const remainder = await addXu(id, -g);
        await i.reply({ content: `✅ Đã gửi yêu cầu đổi **"${q}"** (${g} xu). Còn lại: **${remainder} xu**.`, ephemeral: true });
        try {
            const ch = await client.channels.fetch(ADMIN_CHANNEL_ID);
            if (ch) ch.send({ embeds: [new EmbedBuilder().setTitle('🎁 YÊU CẦU ĐỔI THƯỞNG').addFields({name:'Người đổi',value:`<@${id}>`},{name:'Tên quà',value:q},{name:'Xu trừ',value:`-${g} xu`}).setTimestamp()] });
        } catch {}
    }

    // Các lệnh Admin / Mod
    if (['congxu', 'truxu', 'setgioihan', 'themadmin', 'xoadmin'].includes(i.commandName)) {
        if (!isAdmin) return i.reply({ content: '❌ Bạn không có quyền Admin/Mod!', ephemeral: true });

        if (i.commandName === 'congxu') {
            const u = i.options.getUser('user'), s = i.options.getInteger('soxu');
            const res = await addXu(u.id, s);
            await i.reply(`🛠️ Admin <@${id}> đã cộng **${s} xu** cho <@${u.id}>. Ví: **${res} xu**.`);
        }

        if (i.commandName === 'truxu') {
            const u = i.options.getUser('user'), s = i.options.getInteger('soxu');
            const res = await addXu(u.id, -s);
            await i.reply(`🛠️ Admin <@${id}> đã trừ **${s} xu** của <@${u.id}>. Ví: **${res} xu**.`);
        }

        if (i.commandName === 'setgioihan') {
            const u = i.options.getUser('user'), l = i.options.getInteger('soluot');
            await setLimit(u.id, l);
            await i.reply(`🛠️ Admin <@${id}> đã set giới hạn vượt cho <@${u.id}> thành **${l} lượt/loại link/ngày**.`);
        }

        if (i.commandName === 'themadmin') {
            const u = i.options.getUser('user');
            let admins = [];
            try { admins = await db.getData('/admins') || []; } catch {}
            if (!admins.includes(u.id)) {
                admins.push(u.id);
                await db.push('/admins', admins);
                await i.reply(`👑 Đã phong quyền Admin/Mod cho <@${u.id}>!`);
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
