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
const SO_XU_THUONG = 100;
const GIOI_HAN_MAC_DINH = 3; // Mặc định 3 lần/ngày

// Bộ nhớ tạm lưu Token chống Reload/Back
const usedTokens = new Set();

// Helper Database
async function getXu(userId) {
    try { return await db.getData(`/xu/${userId}`) || 0; } catch { return 0; }
}

async function addXu(userId, amount) {
    const current = await getXu(userId);
    const newTotal = current + amount;
    await db.push(`/xu/${userId}`, newTotal);
    return newTotal;
}

// Lấy giới hạn riêng của user (nếu Admin có set)
async function getLimitOfUser(userId) {
    try { return await db.getData(`/limit/${userId}`) || GIOI_HAN_MAC_DINH; } catch { return GIOI_HAN_MAC_DINH; }
}

async function setLimitOfUser(userId, maxLimit) {
    await db.push(`/limit/${userId}`, maxLimit);
}

// Lấy danh sách thời gian vượt QC hôm nay của user
async function getTodayHistory(userId) {
    try {
        const history = await db.getData(`/history/${userId}`) || [];
        const now = Date.now();
        const oneDayMs = 24 * 60 * 60 * 1000;
        // Lọc lấy các lần vượt trong 24 giờ gần nhất
        const validHistory = history.filter(time => (now - time) < oneDayMs);
        await db.push(`/history/${userId}`, validHistory);
        return validHistory;
    } catch {
        return [];
    }
}

async function recordSuccess(userId) {
    const history = await getTodayHistory(userId);
    history.push(Date.now());
    await db.push(`/history/${userId}`, history);
}

// 🌐 Trang xác nhận vượt link thành công
app.get('/verify-success', async (req, res) => {
    const { userid: userId, token } = req.query;

    const renderWebResponse = (title, message, isSuccess = false) => {
        return `
            <!DOCTYPE html>
            <html lang="vi">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>${title}</title>
                <style>
                    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f4f6f8; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
                    .card { background: white; padding: 40px 30px; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.1); text-align: center; max-width: 400px; width: 90%; }
                    .icon { font-size: 60px; margin-bottom: 10px; }
                    h1 { color: ${isSuccess ? '#2ecc71' : '#e74c3c'}; margin-bottom: 10px; font-size: 22px; }
                    p { color: #555; font-size: 15px; line-height: 1.5; }
                    .badge { background: #e8f8f5; color: #2ecc71; padding: 10px 15px; border-radius: 8px; font-weight: bold; display: inline-block; margin: 15px 0; border: 1px solid #a3e4d7; }
                    .btn { display: block; width: 100%; padding: 14px 0; background: #5865F2; color: white; text-decoration: none; border-radius: 10px; font-weight: bold; font-size: 16px; margin-top: 20px; transition: 0.2s; box-shadow: 0 4px 12px rgba(88, 101, 242, 0.3); }
                </style>
                <script>
                    history.pushState(null, null, location.href);
                    window.onpopstate = function () { history.go(1); };
                </script>
            </head>
            <body>
                <div class="card">
                    <div class="icon">${isSuccess ? '🎉' : '⚠️'}</div>
                    <h1>${title}</h1>
                    <p>${message}</p>
                    ${isSuccess ? `<div class="badge">🪙 Thưởng: +${SO_XU_THUONG} Xu</div>` : ''}
                    <a href="https://discord.com/channels/@me" class="btn">🚀 Mở Discord Ngay</a>
                </div>
            </body>
            </html>
        `;
    };

    if (!userId || !token) {
        return res.status(400).send(renderWebResponse('Liên kết không hợp lệ', 'Vui lòng quay lại Discord gõ lệnh /getlink để lấy link mới.'));
    }

    if (usedTokens.has(token)) {
        return res.send(renderWebResponse('Link đã dùng', 'Bạn không thể bấm Quay lại hoặc tải lại trang để nhận thêm xu.'));
    }

    // Kiểm tra giới hạn lượt trong ngày
    const maxLimit = await getLimitOfUser(userId);
    const todayHistory = await getTodayHistory(userId);

    if (todayHistory.length >= maxLimit) {
        return res.send(renderWebResponse('Đã hết lượt hôm nay', `Bạn đã vượt đủ ${maxLimit}/${maxLimit} lượt trong 24h qua. Hãy quay lại sau nhé!`));
    }

    // Đánh dấu Token đã xài + Ghi nhận 1 lượt vượt
    usedTokens.add(token);
    await recordSuccess(userId);

    const timeString = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

    try {
        const xuMoi = await addXu(userId, SO_XU_THUONG);

        const channel = await client.channels.fetch(ADMIN_CHANNEL_ID);
        if (channel) {
            const embed = new EmbedBuilder()
                .setTitle('🎉 CÓ NGƯỜI VỪA VƯỢT LINK THÀNH CÔNG!')
                .setColor('Green')
                .addFields(
                    { name: '👤 Người dùng', value: `<@${userId}>`, inline: true },
                    { name: '🪙 Thưởng', value: `+${SO_XU_THUONG} xu`, inline: true },
                    { name: '💰 Ví hiện tại', value: `${xuMoi} xu`, inline: true },
                    { name: '📊 Đã vượt hôm nay', value: `${todayHistory.length + 1}/${maxLimit} lượt`, inline: true },
                    { name: '⏰ Thời gian', value: timeString, inline: false }
                )
                .setTimestamp();
            await channel.send({ embeds: [embed] });
        }

        res.send(renderWebResponse('Xác Nhận Thành Công!', 'Bạn đã hoàn thành vượt link QC xuất sắc.', true));
    } catch (err) {
        console.error(err);
        res.status(500).send('Lỗi hệ thống!');
    }
});

app.get('/', (req, res) => res.send('Bot ready!'));
app.listen(process.env.PORT || 3000);

// 📜 Đăng ký các lệnh Slash Commands
const commands = [
    new SlashCommandBuilder().setName('getlink').setDescription('Lấy link vượt QC nhận xu'),
    new SlashCommandBuilder().setName('xemxu').setDescription('Xem số xu hiện có của bạn'),
    new SlashCommandBuilder()
        .setName('doithuong')
        .setDescription('Đổi xu lấy quà tặng')
        .addStringOption(opt => opt.setName('tenqua').setDescription('Tên món quà muốn đổi').setRequired(true))
        .addIntegerOption(opt => opt.setName('giazxu').setDescription('Số xu cần để đổi món quà này').setRequired(true)),
    new SlashCommandBuilder()
        .setName('truxu')
        .setDescription('[ADMIN] Trừ xu của thành viên')
        .addUserOption(opt => opt.setName('user').setDescription('Thành viên bị trừ xu').setRequired(true))
        .addIntegerOption(opt => opt.setName('soxu').setDescription('Số xu muốn trừ').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder()
        .setName('congxu')
        .setDescription('[ADMIN] Cộng xu cho thành viên')
        .addUserOption(opt => opt.setName('user').setDescription('Thành viên được cộng xu').setRequired(true))
        .addIntegerOption(opt => opt.setName('soxu').setDescription('Số xu muốn cộng').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder()
        .setName('setgioihan')
        .setDescription('[ADMIN] Chỉnh số lượt vượt link tối đa/ngày của thành viên')
        .addUserOption(opt => opt.setName('user').setDescription('Thành viên muốn chỉnh').setRequired(true))
        .addIntegerOption(opt => opt.setName('soluot').setDescription('Số lượt tối đa mỗi ngày').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
];

client.on('ready', async () => {
    console.log(`Bot online: ${client.user.tag}`);
    const rest = new REST({ version: '10' }).setToken(TOKEN_BOT);
    try {
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    } catch (e) {
        console.error(e);
    }
});

// 🎮 Xử lý Lệnh Discord
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const userId = interaction.user.id;

    // 1️⃣ Lệnh /getlink
    if (interaction.commandName === 'getlink') {
        await interaction.deferReply({ ephemeral: true });

        const maxLimit = await getLimitOfUser(userId);
        const todayHistory = await getTodayHistory(userId);

        if (todayHistory.length >= maxLimit) {
            return interaction.editReply({
                content: `❌ Bạn đã hết lượt vượt link hôm nay! (Đã dùng **${todayHistory.length}/${maxLimit}** lượt trong 24h qua).`
            });
        }

        const uniqueToken = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const targetUrl = `${process.env.RENDER_EXTERNAL_URL}/verify-success?userid=${userId}&token=${uniqueToken}`;

        let link1 = 'Lỗi tạo link', link2 = 'Lỗi tạo link';
        try {
            const res1 = await axios.get(`https://shrinkme.io/api?api=bbfe266096d2604965ff23d654e8c3dc6d6c5d35&url=${encodeURIComponent(targetUrl)}`);
            if (res1.data) link1 = res1.data.shortenedUrl || res1.data.shorten_url || res1.data.url || 'Lỗi tạo link';
        } catch (e) {}

        try {
            const res2 = await axios.get(`https://shrtfly.com/api?api=27ec1b82df0ebcd873cfdaf23204be70&type=1&url=${encodeURIComponent(targetUrl)}`);
            if (res2.data) link2 = res2.data.result?.shorten_url || res2.data.shorten_url || res2.data.shortenedUrl || res2.data.url || 'Lỗi tạo link';
        } catch (e) {}

        await interaction.editReply({
            content: `🔗 **Chọn 1 trong các link dưới đây để vượt QC (Thưởng +${SO_XU_THUONG} xu):**\n\n1️⃣ **Shrinkme:** ${link1}\n2️⃣ **Shrtfly:** ${link2}\n\n📊 *Lượt hôm nay của bạn: **${todayHistory.length}/${maxLimit}***`
        });
    }

    // 2️⃣ Lệnh /xemxu
    if (interaction.commandName === 'xemxu') {
        const tongXu = await getXu(userId);
        const maxLimit = await getLimitOfUser(userId);
        const todayHistory = await getTodayHistory(userId);

        await interaction.reply({
            content: `💰 Chào <@${userId}>, bạn hiện đang có **${tongXu} xu** trong tài khoản!\n📊 Lượt vượt link hôm nay: **${todayHistory.length}/${maxLimit} lượt**.`,
            ephemeral: true
        });
    }

    // 3️⃣ Lệnh /doithuong
    if (interaction.commandName === 'doithuong') {
        const tenQua = interaction.options.getString('tenqua');
        const giaXu = interaction.options.getInteger('giazxu');
        const tongXuHienTai = await getXu(userId);

        if (tongXuHienTai < giaXu) {
            return interaction.reply({
                content: `❌ Bạn không đủ xu! Bạn hiện có **${tongXuHienTai} xu**, nhưng món quà này cần **${giaXu} xu**.`,
                ephemeral: true
            });
        }

        const xuConLai = await addXu(userId, -giaXu);

        await interaction.reply({
            content: `✅ Bạn đã yêu cầu đổi quà **"${tenQua}"** với giá **${giaXu} xu** thành công! Số xu còn lại: **${xuConLai} xu**. Admin sẽ liên hệ trao quà cho bạn sớm nhất!`,
            ephemeral: true
        });

        try {
            const adminChannel = await client.channels.fetch(ADMIN_CHANNEL_ID);
            if (adminChannel) {
                const embed = new EmbedBuilder()
                    .setTitle('🎁 CÓ YÊU CẦU ĐỔI THƯỞNG MỚI!')
                    .setColor('Yellow')
                    .addFields(
                        { name: '👤 Người đổi', value: `<@${userId}> (ID: ${userId})`, inline: true },
                        { name: '🎁 Tên món quà', value: `${tenQua}`, inline: true },
                        { name: '🪙 Giá xu đã trừ', value: `-${giaXu} xu`, inline: true },
                        { name: '💰 Số xu còn lại', value: `${xuConLai} xu`, inline: true }
                    )
                    .setTimestamp();
                await adminChannel.send({ embeds: [embed] });
            }
        } catch (e) { console.error(e); }
    }

    // 4️⃣ Lệnh /truxu (Admin)
    if (interaction.commandName === 'truxu') {
        const targetUser = interaction.options.getUser('user');
        const soXuTru = interaction.options.getInteger('soxu');

        const xuMoi = await addXu(targetUser.id, -soXuTru);

        await interaction.reply({
            content: `🛠️ **[ADMIN]** Đã trừ **${soXuTru} xu** của <@${targetUser.id}>. Số xu hiện tại: **${xuMoi} xu**.`
        });
    }

    // 5️⃣ Lệnh /congxu (Admin)
    if (interaction.commandName === 'congxu') {
        const targetUser = interaction.options.getUser('user');
        const soXuCong = interaction.options.getInteger('soxu');

        const xuMoi = await addXu(targetUser.id, soXuCong);

        await interaction.reply({
            content: `🛠️ **[ADMIN]** Đã cộng **${soXuCong} xu** cho <@${targetUser.id}>. Số xu hiện tại: **${xuMoi} xu**.`
        });
    }

    // 6️⃣ Lệnh /setgioihan (Admin)
    if (interaction.commandName === 'setgioihan') {
        const targetUser = interaction.options.getUser('user');
        const soLuot = interaction.options.getInteger('soluot');

        await setLimitOfUser(targetUser.id, soLuot);

        await interaction.reply({
            content: `🛠️ **[ADMIN]** Đã chỉnh giới hạn vượt link của <@${targetUser.id}> thành **${soLuot} lượt/ngày**.`
        });
    }
});

client.login(TOKEN_BOT);
