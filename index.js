const {
    Client,
    GatewayIntentBits,
    SlashCommandBuilder,
    REST,
    Routes,
    EmbedBuilder,
    PermissionFlagsBits
} = require('discord.js');

const express = require('express');
const axios = require('axios');
const { JsonDB, Config } = require('node-json-db');

const db = new JsonDB(
    new Config('database', true, false, '/')
);

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// =========================
// ENV
// =========================

const TOKEN_BOT = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const ADMIN_CHANNEL_ID = process.env.ADMIN_CHANNEL_ID;
const OWNER_ID = process.env.OWNER_ID || '';

const SHRTFLY_API_KEY = process.env.SHRTFLY_API_KEY || '';
const SHRINKME_API_KEY = process.env.SHRINKME_API_KEY || '';
const OCTOLINKZ_API_KEY = process.env.OCTOLINKZ_API_KEY || '';

const RENDER_URL =
    process.env.RENDER_EXTERNAL_URL ||
    'https://your-app.onrender.com';

// =========================
// CONFIG
// =========================

const GIOI_HAN_MAC_DINH = 3;

const usedTokens = new Set();
const pendingCaptchas = new Map();

// =========================
// DATABASE HELPERS
// =========================

async function getXu(id) {
    try {
        return await db.getData(`/xu/${id}`) || 0;
    } catch {
        return 0;
    }
}

async function addXu(id, amount) {
    const current = await getXu(id);
    const total = current + amount;

    await db.push(`/xu/${id}`, total);

    return total;
}

async function getLimit(id) {
    try {
        return await db.getData(`/limit/${id}`) || GIOI_HAN_MAC_DINH;
    } catch {
        return GIOI_HAN_MAC_DINH;
    }
}

async function setLimit(id, max) {
    await db.push(`/limit/${id}`, max);
}

async function getLinkHistory(id, linkType) {
    try {
        const history =
            await db.getData(`/history_${linkType}/${id}`) || [];

        const now = Date.now();

        const valid = history.filter(
            time => (now - time) < 86400000
        );

        await db.push(
            `/history_${linkType}/${id}`,
            valid
        );

        return valid;
    } catch {
        return [];
    }
}

// =========================
// ADMIN CHECK
// =========================

async function checkIsAdmin(member, userId) {

    if (userId === OWNER_ID) {
        return true;
    }

    if (
        member &&
        member.permissions &&
        member.permissions.has(PermissionFlagsBits.ManageGuild)
    ) {
        return true;
    }

    try {
        const admins =
            await db.getData('/admins') || [];

        return admins.includes(userId);
    } catch {
        return false;
    }
}

// =========================
// VERIFY PAGE
// =========================

app.get('/verify-success', async (req, res) => {

    const {
        userid: id,
        token,
        type: linkType
    } = req.query;

    if (!id || !token || !linkType) {
        return res.send(
            '<h2>❌ Đường dẫn không hợp lệ!</h2>'
        );
    }

    if (usedTokens.has(token)) {
        return res.send(
            '<h2>⚠️ Link này đã được xác nhận trước đó!</h2>'
        );
    }

    const maxL = await getLimit(id);

    const history =
        await getLinkHistory(id, linkType);

    if (history.length >= maxL) {
        return res.send(`
            <h2>
                ⚠️ Bạn đã hết lượt vượt link hôm nay
                (${history.length}/${maxL})!
            </h2>
        `);
    }

    const captchaCode =
        Math.floor(1000 + Math.random() * 9000).toString();

    pendingCaptchas.set(
        token,
        captchaCode
    );

    res.send(`
<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport"
content="width=device-width, initial-scale=1.0">

<title>Xác minh</title>

<style>

body {
    font-family: Arial, sans-serif;
    background: #0f172a;
    color: white;

    display: flex;
    justify-content: center;
    align-items: center;

    height: 100vh;
    margin: 0;
}

.card {
    background: #1e293b;
    padding: 30px;
    border-radius: 12px;

    box-shadow:
        0 8px 24px rgba(0,0,0,.3);

    text-align: center;
    width: 320px;
}

.captcha-box {
    background: #334155;

    font-size: 28px;
    font-weight: bold;

    letter-spacing: 6px;

    padding: 10px;

    border-radius: 8px;

    margin: 15px 0;

    color: #38bdf8;

    user-select: none;
}

input {
    width: 90%;

    padding: 12px;

    border: none;
    border-radius: 6px;

    text-align: center;

    font-size: 18px;

    margin-bottom: 15px;

    outline: none;
}

button {
    width: 100%;

    padding: 12px;

    background: #22c55e;

    color: white;

    border: none;

    border-radius: 6px;

    font-size: 16px;

    font-weight: bold;

    cursor: pointer;
}

button:hover {
    background: #16a34a;
}

</style>
</head>

<body>

<div class="card">

<h2>🤖 Xác minh Captcha</h2>

<p style="color:#94a3b8">
Nhập mã bên dưới để hoàn tất
</p>

<div class="captcha-box">
${captchaCode}
</div>

<form
action="/submit-captcha"
method="POST"
>

<input
type="hidden"
name="userid"
value="${id}"
>

<input
type="hidden"
name="token"
value="${token}"
>

<input
type="hidden"
name="type"
value="${linkType}"
>

<input
type="text"
name="captcha"
placeholder="Nhập 4 số"
maxlength="4"
required
autocomplete="off"
>

<button type="submit">
XÁC NHẬN HOÀN TẤT
</button>

</form>

</div>

</body>
</html>
`);
});

// =========================
// CAPTCHA SUBMIT
// =========================

app.post('/submit-captcha', async (req, res) => {

    const {
        userid: id,
        token,
        type: linkType,
        captcha
    } = req.body;

    const realCaptcha =
        pendingCaptchas.get(token);

    if (
        !token ||
        !realCaptcha ||
        captcha !== realCaptcha
    ) {
        return res.send(`
            <div style="
                text-align:center;
                padding:50px;
                font-family:sans-serif;
            ">

            <h1 style="color:#ef4444">
                ❌ Captcha không chính xác!
            </h1>

            <a
            href="javascript:history.back()"
            style="
                padding:10px 20px;
                background:#3b82f6;
                color:#fff;
                text-decoration:none;
                border-radius:6px;
            "
            >
            Thử lại
            </a>

            </div>
        `);
    }

    if (usedTokens.has(token)) {
        return res.send(
            '<h2 style="text-align:center;margin-top:50px;">⚠️ Link đã được xác nhận!</h2>'
        );
    }

    let typeName = 'ShrtFly';

    if (linkType === 'shrinkme') {
        typeName = 'ShrinkMe';
    }

    if (linkType === 'octolinkz') {
        typeName = 'OctoLinkz';
    }

    const maxL = await getLimit(id);

    const history =
        await getLinkHistory(id, linkType);

    if (history.length >= maxL) {
        return res.send(`
            <h2 style="text-align:center;margin-top:50px;">
                ⚠️ Bạn đã hết lượt ${typeName} hôm nay!
            </h2>
        `);
    }

    usedTokens.add(token);

    pendingCaptchas.delete(token);

    history.push(Date.now());

    await db.push(
        `/history_${linkType}/${id}`,
        history
    );

    // =========================
    // ADMIN NOTIFICATION
    // =========================

    try {

        const channel =
            await client.channels.fetch(
                ADMIN_CHANNEL_ID
            );

        if (channel) {

            let userDisplay =
                `<@${id}>`;

            try {

                const userObj =
                    await client.users.fetch(id);

                if (userObj) {

                    const name =
                        userObj.globalName ||
                        userObj.username;

                    userDisplay =
                        `**${name}** (<@${id}>)`;
                }

            } catch {}

            const embed =
                new EmbedBuilder()
                    .setTitle(
                        '🔔 HOÀN THÀNH VƯỢT LINK'
                    )
                    .setColor('Yellow')
                    .addFields(

                        {
                            name: '👤 Người dùng',
                            value: userDisplay,
                            inline: true
                        },

                        {
                            name: '🔗 Loại link',
                            value: typeName,
                            inline: true
                        },

                        {
                            name: '📊 Lượt hôm nay',
                            value:
                                `${history.length}/${maxL}`,
                            inline: true
                        },

                        {
                            name: '⚠️ Trạng thái',
                            value:
                                'Đã hoàn thành CAPTCHA. Dùng /congxu để cộng xu.',
                            inline: false
                        }

                    )
                    .setTimestamp();

            await channel.send({
                embeds: [embed]
            });
        }

    } catch (error) {

        console.error(
            'Không gửi được thông báo Admin:',
            error
        );
    }

    res.send(`
<!DOCTYPE html>
<html lang="vi">

<head>

<meta charset="UTF-8">

<meta
name="viewport"
content="width=device-width, initial-scale=1.0"
>

<title>Thành công</title>

<style>

body {
    font-family: Arial;
    background: #0f172a;
    color: white;

    text-align: center;

    padding-top: 80px;
}

.box {
    background: #1e293b;

    display: inline-block;

    padding: 40px;

    border-radius: 12px;
}

h1 {
    color: #22c55e;
}

a {
    display: inline-block;

    margin-top: 15px;

    padding: 12px 24px;

    background: #5865F2;

    color: white;

    text-decoration: none;

    border-radius: 8px;

    font-weight: bold;
}

</style>

<script>

setTimeout(() => {

    window.location.href =
        "https://discord.com/channels/@me";

}, 2000);

</script>

</head>

<body>

<div class="box">

<h1>
🎉 XÁC MINH THÀNH CÔNG!
</h1>

<p>
Hệ thống đã ghi nhận lượt vượt link.
</p>

<p style="color:#94a3b8">
Đang chuyển về Discord...
</p>

<a
href="https://discord.com/channels/@me"
>
🚀 Mở Discord
</a>

</div>

</body>
</html>
`);
});

// =========================
// HOME
// =========================

app.get('/', (req, res) => {
    res.send('Bot is running online!');
});

app.listen(
    process.env.PORT || 3000,
    () => {
        console.log(
            `Web server running on port ${
                process.env.PORT || 3000
            }`
        );
    }
);

// =========================
// COMMANDS
// =========================

const commands = [

    new SlashCommandBuilder()
        .setName('getlink')
        .setDescription(
            'Lấy link vượt quảng cáo'
        ),

    new SlashCommandBuilder()
        .setName('xemxu')
        .setDescription(
            'Xem số xu'
        )
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription(
                    'Thành viên'
                )
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName('doithuong')
        .setDescription(
            'Đổi xu lấy phần thưởng'
        )
        .addStringOption(option =>
            option
                .setName('tenqua')
                .setDescription(
                    'Tên món quà'
                )
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option
                .setName('giazxu')
                .setDescription(
                    'Số xu cần đổi'
                )
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('congxu')
        .setDescription(
            '[ADMIN] Cộng xu'
        )
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription(
                    'Thành viên'
                )
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option
                .setName('soxu')
                .setDescription(
                    'Số xu cộng'
                )
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('truxu')
        .setDescription(
            '[ADMIN] Trừ xu'
        )
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription(
                    'Thành viên'
                )
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option
                .setName('soxu')
                .setDescription(
                    'Số xu trừ'
                )
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('setgioihan')
        .setDescription(
            '[ADMIN] Set giới hạn/ngày'
        )
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription(
                    'Thành viên'
                )
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option
                .setName('soluot')
                .setDescription(
                    'Số lượt'
                )
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('themadmin')
        .setDescription(
            '[ADMIN] Thêm Admin'
        )
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription(
                    'Thành viên'
                )
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('xoadmin')
        .setDescription(
            '[ADMIN] Xóa Admin'
        )
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription(
                    'Thành viên'
                )
                .setRequired(true)
        )

];

// =========================
// READY
// =========================

client.once('ready', async () => {

    console.log(
        `Bot online: ${client.user.tag}`
    );

    const rest =
        new REST({ version: '10' })
            .setToken(TOKEN_BOT);

    try {

        await rest.put(
            Routes.applicationCommands(
                CLIENT_ID
            ),
            {
                body: commands.map(
                    command => command.toJSON()
                )
            }
        );

        console.log(
            'Slash commands registered!'
        );

    } catch (error) {

        console.error(
            'Slash command error:',
            error
        );
    }
});

// =========================
// INTERACTION
// =========================

client.on(
    'interactionCreate',
    async interaction => {

        if (!interaction.isChatInputCommand()) {
            return;
        }

        try {

            await interaction.deferReply({
                ephemeral: true
            });

        } catch (error) {

            console.error(
                'deferReply error:',
                error
            );

            return;
        }

        const id =
            interaction.user.id;

        const isAdmin =
            await checkIsAdmin(
                interaction.member,
                id
            );

        // =====================
        // GETLINK
        // =====================

        if (
            interaction.commandName === 'getlink'
        ) {

            try {

                const maxL =
                    await getLimit(id);

                const [
                    hS,
                    hSM,
                    hOCT
                ] = await Promise.all([

                    getLinkHistory(
                        id,
                        'shrtfly'
                    ),

                    getLinkHistory(
                        id,
                        'shrinkme'
                    ),

                    getLinkHistory(
                        id,
                        'octolinkz'
                    )

                ]);

                const remS =
                    Math.max(
                        0,
                        maxL - hS.length
                    );

                const remSM =
                    Math.max(
                        0,
                        maxL - hSM.length
                    );

                const remOCT =
                    Math.max(
                        0,
                        maxL - hOCT.length
                    );

                if (
                    remS <= 0 &&
                    remSM <= 0 &&
                    remOCT <= 0
                ) {

                    return await interaction.editReply(
                        `❌ Bạn đã hết lượt vượt link hôm nay (${maxL}/${maxL})!`
                    );
                }

                // =====================
                // UNIQUE TOKENS
                // =====================

                const tS =
                    `${Date.now()}_s_${Math.random()
                        .toString(36)
                        .substring(2, 10)}`;

                const tSM =
                    `${Date.now()}_sm_${Math.random()
                        .toString(36)
                        .substring(2, 10)}`;

                const tOCT =
                    `${Date.now()}_oct_${Math.random()
                        .toString(36)
                        .substring(2, 10)}`;

                const targetS =
                    `${RENDER_URL}/verify-success?userid=${encodeURIComponent(id)}&token=${encodeURIComponent(tS)}&type=shrtfly`;

                const targetSM =
                    `${RENDER_URL}/verify-success?userid=${encodeURIComponent(id)}&token=${encodeURIComponent(tSM)}&type=shrinkme`;

                const targetOCT =
                    `${RENDER_URL}/verify-success?userid=${encodeURIComponent(id)}&token=${encodeURIComponent(tOCT)}&type=octolinkz`;

                const axiosConfig = {
                    timeout: 8000
                };

                // =====================
                // API REQUESTS
                // =====================

                let lS =
                    '🚫 Hết lượt';

                let lSM =
                    '🚫 Hết lượt';

                let lOCT =
                    '🚫 Hết lượt';

                // SHRTFLY

                if (
                    remS > 0 &&
                    SHRTFLY_API_KEY
                ) {

                    try {

                        const response =
                            await axios.get(
                                'https://shrtfly.com/api',
                                {
                                    params: {
                                        api:
                                            SHRTFLY_API_KEY,

                                        type: 1,

                                        url:
                                            targetS,

                                        format: 'json'
                                    },

                                    ...axiosConfig
                                }
                            );

                        const data =
                            response.data;

                        const url =
                            data?.shortenedUrl ||
                            data?.shorten_url ||
                            data?.url ||
                            data?.result?.shorten_url;

                        if (url) {

                            lS =
                                `<${url}>`;

                        } else {

                            console.error(
                                'ShrtFly response:',
                                data
                            );

                            lS =
                                '❌ API không trả về link';

                        }

                    } catch (error) {

                        console.error(
                            'ShrtFly error:',
                            error.message
                        );

                        lS =
                            '❌ Lỗi kết nối ShrtFly';
                    }

                } else if (remS > 0) {

                    lS =
                        '⚠️ Chưa cấu hình API';

                }

                // SHRINKME

                if (
                    remSM > 0 &&
                    SHRINKME_API_KEY
                ) {

                    try {

                        const response =
                            await axios.get(
                                'https://shrinkme.io/api',
                                {
                                    params: {
                                        api:
                                            SHRINKME_API_KEY,

                                        url:
                                            targetSM
                                    },

                                    ...axiosConfig
                                }
                            );

                        const data =
                            response.data;

                        const url =
                            data?.shortenedUrl ||
                            data?.shorten_url ||
                            data?.url ||
                            data?.result?.shorten_url;

                        if (url) {

                            lSM =
                                `<${url}>`;

                        } else {

                            console.error(
                                'ShrinkMe response:',
                                data
                            );

                            lSM =
                                '❌ API không trả về link';

                        }

                    } catch (error) {

                        console.error(
                            'ShrinkMe error:',
                            error.message
                        );

                        lSM =
                            '❌ Lỗi kết nối ShrinkMe';
                    }

                } else if (remSM > 0) {

                    lSM =
                        '⚠️ Chưa cấu hình API';

                }

                // OCTOLINKZ
                //
                // Giữ request theo endpoint API
                // đang có trong code gốc.
                //

                if (
                    remOCT > 0 &&
                    OCTOLINKZ_API_KEY
                ) {

                    try {

                        const response =
                            await axios.get(
                                'https://octolinkz.com/api',
                                {
                                    params: {
                                        api:
                                            OCTOLINKZ_API_KEY,

                                        url:
                                            targetOCT
                                    },

                                    ...axiosConfig
                                }
                            );

                        const data =
                            response.data;

                        console.log(
                            'Octolinkz response:',
                            data
                        );

                        const url =
                            data?.shortenedUrl ||
                            data?.shorten_url ||
                            data?.short_url ||
                            data?.url ||
                            data?.result?.shorten_url ||
                            data?.result?.url;

                        if (url) {

                            lOCT =
                                `<${url}>`;

                        } else {

                            lOCT =
                                '❌ API không trả về link';

                        }

                    } catch (error) {

                        console.error(
                            'Octolinkz error:',
                            error.response?.data ||
                            error.message
                        );

                        lOCT =
                            '❌ Lỗi kết nối Octolinkz';
                    }

                } else if (remOCT > 0) {

                    lOCT =
                        '⚠️ Chưa cấu hình API';

                }

                // =====================
                // DISCORD MESSAGE
                // =====================

                const message =
                    `🔗 **DANH SÁCH LINK VƯỢT QC**\n\n` +

                    `1️⃣ **Link ShrtFly** ` +
                    `*(Còn ${remS}/${maxL} lượt)*\n` +
                    `${lS}\n\n` +

                    `2️⃣ **Link ShrinkMe** ` +
                    `*(Còn ${remSM}/${maxL} lượt)*\n` +
                    `${lSM}\n\n` +

                    `3️⃣ **Link OctoLinkz** ` +
                    `*(Còn ${remOCT}/${maxL} lượt)*\n` +
                    `${lOCT}`;

                await interaction.editReply(
                    message
                );

            } catch (error) {

                console.error(
                    'getlink error:',
                    error
                );

                await interaction.editReply(
                    '❌ Đã xảy ra lỗi khi tạo link. Kiểm tra Logs trên Render.'
                );
            }

            return;
        }

        // =====================
        // XEM XU
        // =====================

        if (
            interaction.commandName === 'xemxu'
        ) {

            try {

                const targetUser =
                    interaction.options.getUser(
                        'user'
                    );

                if (
                    targetUser &&
                    targetUser.id !== id &&
                    !isAdmin
                ) {

                    return await interaction.editReply(
                        '❌ Bạn không có quyền xem xu của người khác!'
                    );
                }

                const userToCheck =
                    targetUser || interaction.user;

                const xu =
                    await getXu(
                        userToCheck.id
                    );

                const maxL =
                    await getLimit(
                        userToCheck.id
                    );

                const [
                    hS,
                    hSM,
                    hOCT
                ] = await Promise.all([

                    getLinkHistory(
                        userToCheck.id,
                        'shrtfly'
                    ),

                    getLinkHistory(
                        userToCheck.id,
                        'shrinkme'
                    ),

                    getLinkHistory(
                        userToCheck.id,
                        'octolinkz'
                    )

                ]);

                const remS =
                    Math.max(
                        0,
                        maxL - hS.length
                    );

                const remSM =
                    Math.max(
                        0,
                        maxL - hSM.length
                    );

                const remOCT =
                    Math.max(
                        0,
                        maxL - hOCT.length
                    );

                await interaction.editReply(
                    `💰 **${userToCheck.username}** có **${xu} xu**!\n\n` +
                    `📊 Lượt còn hôm nay:\n` +
                    `• ShrtFly: **${remS}/${maxL}**\n` +
                    `• ShrinkMe: **${remSM}/${maxL}**\n` +
                    `• OctoLinkz: **${remOCT}/${maxL}**`
                );

            } catch (error) {

                console.error(
                    'xemxu error:',
                    error
                );

                await interaction.editReply(
                    '❌ Không thể xem xu.'
                );
            }

            return;
        }

        // =====================
        // DOI THUONG
        // =====================

        if (
            interaction.commandName === 'doithuong'
        ) {

            try {

                const tenqua =
                    interaction.options.getString(
                        'tenqua'
                    );

                const gia =
                    interaction.options.getInteger(
                        'giazxu'
                    );

                if (gia <= 0) {

                    return await interaction.editReply(
                        '❌ Giá xu phải lớn hơn 0.'
                    );
                }

                const xu =
                    await getXu(id);

                if (xu < gia) {

                    return await interaction.editReply(
                        `❌ Không đủ xu! Bạn có **${xu} xu**, cần **${gia} xu**.`
                    );
                }

                const remaining =
                    await addXu(
                        id,
                        -gia
                    );

                await interaction.editReply(
                    `✅ Đã gửi yêu cầu đổi **${tenqua}**.\n` +
                    `💰 Đã trừ: **${gia} xu**\n` +
                    `💰 Còn lại: **${remaining} xu**`
                );

                try {

                    const channel =
                        await client.channels.fetch(
                            ADMIN_CHANNEL_ID
                        );

                    if (channel) {

                        const embed =
                            new EmbedBuilder()
                                .setTitle(
                                    '🎁 YÊU CẦU ĐỔI THƯỞNG'
                                )
                                .addFields(

                                    {
                                        name: 'Người đổi',
                                        value: `<@${id}>`
                                    },

                                    {
                                        name: 'Tên quà',
                                        value: tenqua
                                    },

                                    {
                                        name: 'Xu trừ',
                                        value:
                                            `-${gia} xu`
                                    }

                                )
                                .setTimestamp();

                        await channel.send({
                            embeds: [embed]
                        });
                    }

                } catch {}

            } catch (error) {

                console.error(
                    'doithuong error:',
                    error
                );

                await interaction.editReply(
                    '❌ Lỗi khi đổi thưởng.'
                );
            }

            return;
        }

        // =====================
        // ADMIN COMMANDS
        // =====================

        if (
            [
                'congxu',
                'truxu',
                'setgioihan',
                'themadmin',
                'xoadmin'
            ].includes(
                interaction.commandName
            )
        ) {

            if (!isAdmin) {

                return await interaction.editReply(
                    '❌ Bạn không có quyền Admin/Mod!'
                );
            }

            try {

                // CONGXU

                if (
                    interaction.commandName ===
                    'congxu'
                ) {

                    const user =
                        interaction.options.getUser(
                            'user'
                        );

                    const amount =
                        interaction.options.getInteger(
                            'soxu'
                        );

                    if (amount <= 0) {

                        return await interaction.editReply(
                            '❌ Số xu phải lớn hơn 0.'
                        );
                    }

                    const total =
                        await addXu(
                            user.id,
                            amount
                        );

                    return await interaction.editReply(
                        `🛠️ Đã cộng **${amount} xu** cho <@${user.id}>.\n💰 Ví: **${total} xu**`
                    );
                }

                // TRUXU

                if (
                    interaction.commandName ===
                    'truxu'
                ) {

                    const user =
                        interaction.options.getUser(
                            'user'
                        );

                    const amount =
                        interaction.options.getInteger(
                            'soxu'
                        );

                    if (amount <= 0) {

                        return await interaction.editReply(
                            '❌ Số xu phải lớn hơn 0.'
                        );
                    }

                    const total =
                        await addXu(
                            user.id,
                            -amount
                        );

                    return await interaction.editReply(
                        `🛠️ Đã trừ **${amount} xu** của <@${user.id}>.\n💰 Ví: **${total} xu**`
                    );
                }

                // SET LIMIT

                if (
                    interaction.commandName ===
                    'setgioihan'
                ) {

                    const user =
                        interaction.options.getUser(
                            'user'
                        );

                    const limit =
                        interaction.options.getInteger(
                            'soluot'
                        );

                    if (limit < 0) {

                        return await interaction.editReply(
                            '❌ Giới hạn không được âm.'
                        );
                    }

                    await setLimit(
                        user.id,
                        limit
                    );

                    return await interaction.editReply(
                        `🛠️ Đã set giới hạn cho <@${user.id}> thành **${limit} lượt/ngày**.`
                    );
                }

                // THEM ADMIN

                if (
                    interaction.commandName ===
                    'themadmin'
                ) {

                    const user =
                        interaction.options.getUser(
                            'user'
                        );

                    let admins = [];

                    try {

                        admins =
                            await db.getData(
                                '/admins'
                            ) || [];

                    } catch {}

                    if (
                        !admins.includes(
                            user.id
                        )
                    ) {

                        admins.push(
                            user.id
                        );

                        await db.push(
                            '/admins',
                            admins
                        );

                        return await interaction.editReply(
                            `👑 Đã thêm <@${user.id}> làm Admin/Mod!`
                        );
                    }

                    return await interaction.editReply(
                        `⚠️ <@${user.id}> đã là Admin/Mod.`
                    );
                }

                // XOA ADMIN

                if (
                    interaction.commandName ===
                    'xoadmin'
                ) {

                    const user =
                        interaction.options.getUser(
                            'user'
                        );

                    let admins = [];

                    try {

                        admins =
                            await db.getData(
                                '/admins'
                            ) || [];

                    } catch {}

                    admins =
                        admins.filter(
                            adminId =>
                                adminId !== user.id
                        );

                    await db.push(
                        '/admins',
                        admins
                    );

                    return await interaction.editReply(
                        `🗑️ Đã gỡ Admin/Mod của <@${user.id}>.`
                    );
                }

            } catch (error) {

                console.error(
                    'Admin command error:',
                    error
                );

                await interaction.editReply(
                    '❌ Có lỗi khi thực hiện lệnh Admin.'
                );
            }
        }
    }
);

// =========================
// LOGIN
// =========================

if (!TOKEN_BOT) {
    console.error(
        '❌ Thiếu biến môi trường TOKEN'
    );
} else {

    client.login(TOKEN_BOT)
        .then(() => {
            console.log(
                'Đang đăng nhập Discord...'
            );
        })
        .catch(error => {
            console.error(
                '❌ Discord login error:',
                error
            );
        });
}
