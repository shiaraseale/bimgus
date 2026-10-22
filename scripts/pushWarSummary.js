const axios = require('axios');
const fs = require('fs');
const path = require('path');

async function run() {
  const envPath = path.join(__dirname, '../functions/.env');
  const envContent = fs.readFileSync(envPath, 'utf8');

  const tokenMatch = envContent.match(/COC_API_TOKEN=(.*)/);
  const webhookMatch = envContent.match(/DISCORD_WEBHOOK_WAR_ROOM=(.*)/);

  if (!tokenMatch || !webhookMatch) {
    console.error('Missing COC_API_TOKEN or DISCORD_WEBHOOK_WAR_ROOM');
    process.exit(1);
  }

  const token = tokenMatch[1].trim();
  const webhookUrl = webhookMatch[1].trim();

  console.log('Fetching live war from proxy...');
  const warRes = await axios.get('http://203.0.113.10/v1/clans/%23ABC123/currentwar', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const currentWar = warRes.data;

  // Flatten clan attacks and opponent attacks
  const allAttacks = [];
  const clanMap = new Map(currentWar.clan.members.map((m) => [m.tag, m]));
  const oppMap = new Map(currentWar.opponent.members.map((m) => [m.tag, m]));

  for (const m of currentWar.clan.members) {
    if (m.attacks) {
      for (const atk of m.attacks) {
        allAttacks.push({
          ...atk,
          isClanAttack: true,
          attacker: m,
          defender: oppMap.get(atk.defenderTag) || { name: 'Unknown', mapPosition: 0, tag: atk.defenderTag, townhallLevel: 0 },
        });
      }
    }
  }

  // Wasted attacks tracking (order ascending)
  const oppBestStars = new Map();
  const wastedAttacks = [];

  const clanAttacksSorted = allAttacks
    .filter((a) => a.isClanAttack)
    .sort((a, b) => a.order - b.order);

  for (const atk of clanAttacksSorted) {
    const prevBest = oppBestStars.get(atk.defender.tag);
    if (prevBest && prevBest.stars === 3) {
      wastedAttacks.push({
        attackerName: atk.attacker.name,
        attackerPos: atk.attacker.mapPosition,
        defenderName: atk.defender.name,
        defenderPos: atk.defender.mapPosition,
        stars: atk.stars,
        destruction: atk.destructionPercentage,
        previousAttacker: prevBest.attackerName,
      });
    }
    if (!prevBest || atk.stars > prevBest.stars) {
      oppBestStars.set(atk.defender.tag, {
        stars: atk.stars,
        attackerName: atk.attacker.name,
        order: atk.order,
      });
    }
  }

  const zeroAttacks = [];
  const partialAttacks = [];
  const mvps = [];

  for (const m of currentWar.clan.members) {
    const used = m.attacks ? m.attacks.length : 0;
    const starsGained = (m.attacks || []).reduce((acc, a) => acc + a.stars, 0);
    const totalDestruction = (m.attacks || []).reduce((acc, a) => acc + a.destructionPercentage, 0);

    if (used === 0) {
      zeroAttacks.push(m);
    } else if (used === 1) {
      partialAttacks.push({ member: m, starsGained });
    } else if (used === 2 && starsGained === 6) {
      mvps.push({ member: m, totalStars: starsGained, avgDestruction: totalDestruction / 2 });
    }
  }

  const won =
    currentWar.clan.stars > currentWar.opponent.stars ||
    (currentWar.clan.stars === currentWar.opponent.stars &&
      currentWar.clan.destructionPercentage > currentWar.opponent.destructionPercentage);
  const tied =
    currentWar.clan.stars === currentWar.opponent.stars &&
    currentWar.clan.destructionPercentage === currentWar.opponent.destructionPercentage;

  const outcomeTitle = won ? '🏆 WAR VICTORY!' : tied ? '🤝 WAR TIED!' : '💀 WAR DEFEAT';
  const outcomeColor = won ? 0xf5a623 : tied ? 0x3b82f6 : 0xef4444;

  // 1. War Summary Embed
  const endEmbed = {
    title: outcomeTitle,
    description: [
      `The war against **${currentWar.opponent.name}** has officially ended!`,
      '',
      `🏰 **${currentWar.clan.name}**:`,
      `⭐ **Stars**: ${currentWar.clan.stars}`,
      `💥 **Destruction**: ${currentWar.clan.destructionPercentage.toFixed(2)}%`,
      `🗡️ **Attacks Used**: ${currentWar.clan.attacks}/${currentWar.teamSize * 2}`,
      '',
      `⚔️ **${currentWar.opponent.name}**:`,
      `⭐ **Stars**: ${currentWar.opponent.stars}`,
      `💥 **Destruction**: ${currentWar.opponent.destructionPercentage.toFixed(2)}%`,
      `🗡️ **Attacks Used**: ${currentWar.opponent.attacks}/${currentWar.teamSize * 2}`,
    ].join('\n'),
    color: outcomeColor,
    footer: { text: 'Bimgus • Clash of Clans Tracker' },
    timestamp: new Date().toISOString(),
  };

  // 2. Audit Embed
  const auditLines = [];

  if (zeroAttacks.length > 0) {
    auditLines.push('🚨 **Missed All Attacks (0/2)**:');
    zeroAttacks
      .sort((a, b) => a.mapPosition - b.mapPosition)
      .forEach((m) => {
        auditLines.push(`• **#${m.mapPosition} ${m.name}** (TH${m.townhallLevel}) — 0 attacks`);
      });
    auditLines.push('');
  } else {
    auditLines.push('✅ **100% Participation**: Every player attacked at least once!');
    auditLines.push('');
  }

  if (partialAttacks.length > 0) {
    auditLines.push('⚠️ **Partial Attacks (1/2)**:');
    partialAttacks
      .sort((a, b) => a.member.mapPosition - b.member.mapPosition)
      .forEach(({ member, starsGained }) => {
        auditLines.push(`• **#${member.mapPosition} ${member.name}** (TH${member.townhallLevel}) — 1 attack (${starsGained} ⭐)`);
      });
    auditLines.push('');
  }

  if (wastedAttacks.length > 0) {
    auditLines.push('🎯 **Attacked Bases Already 3-Starred (0 Net Stars)**:');
    wastedAttacks.forEach((w) => {
      auditLines.push(`• **#${w.attackerPos} ${w.attackerName}** attacked **#${w.defenderPos} ${w.defenderName}** (was already 3 ⭐ by ${w.previousAttacker})`);
    });
    auditLines.push('');
  } else {
    auditLines.push('🎯 **Smart Targeting**: No attacks were wasted on already 3-starred bases!');
    auditLines.push('');
  }

  if (mvps.length > 0) {
    auditLines.push('⭐ **War MVPs (6 ⭐ Max Hitters)**:');
    mvps
      .sort((a, b) => a.member.mapPosition - b.member.mapPosition)
      .forEach((mvp) => {
        auditLines.push(`• **#${mvp.member.mapPosition} ${mvp.member.name}** (TH${mvp.member.townhallLevel}) — 6 ⭐ (${mvp.avgDestruction.toFixed(0)}% avg)`);
      });
  }

  const auditEmbed = {
    title: '📋 Post-War Performance & Tactical Audit',
    description: auditLines.join('\n'),
    color: 0x8b5cf6,
    footer: { text: 'Bimgus • Clash of Clans Tracker' },
    timestamp: new Date().toISOString(),
  };

  console.log('Sending endEmbed...');
  await axios.post(webhookUrl, { embeds: [endEmbed] });

  await new Promise((r) => setTimeout(r, 600));

  console.log('Sending auditEmbed...');
  await axios.post(webhookUrl, { embeds: [auditEmbed] });

  console.log('🎉 Successfully posted full war summary and audit to Discord!');
}

run().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
