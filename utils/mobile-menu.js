// utils/mobile-menu.js
// Turns req.user.menuDetails (the role/location-filtered menu cache) into
// tile groups for the phone home page (/m). Grouping mirrors the sidebar in
// layout.pug: a child item belongs to its parent's group, and sub-dropdowns
// (e.g. Transactions, Reports) are flattened into their group — a phone home
// screen should be one level deep, not a tree.

// Icon / tint per group, cycled by group order. Tints are light so the
// coloured icon on top keeps contrast.
const GROUP_TONES = [
    { fg: '#8a4b00', bg: '#fdf0c4' },
    { fg: '#1d4ed8', bg: '#dce7fd' },
    { fg: '#5b2bc4', bg: '#e9e2fd' },
    { fg: '#0f6b63', bg: '#cdf3ec' },
    { fg: '#a8370b', bg: '#fde3cf' },
    { fg: '#2f3b4c', bg: '#e2e7ee' },
    { fg: '#3f4652', bg: '#eceef1' }
];

const FALLBACK_ICON = 'bi-grid';

function buildMobileMenuGroups(menuDetails) {
    const menus = menuDetails || [];
    const childrenByParent = {};
    menus.forEach(m => {
        if (m.parent_code) {
            (childrenByParent[m.parent_code] = childrenByParent[m.parent_code] || []).push(m);
        }
    });

    const groups = {};
    const seenUrls = new Set();
    const addItem = (group, m) => {
        if (!m.url_path || seenUrls.has(m.url_path)) return;
        seenUrls.add(m.url_path);
        group.items.push({
            name: m.menu_name,
            url: m.url_path,
            icon: (m.icon && m.icon !== 'bi-circle') ? m.icon : FALLBACK_ICON
        });
    };

    menus.forEach(m => {
        if (m.parent_code) return;
        const code = (m.group_name && m.group_code) ? m.group_code : 'ADMIN';
        const group = groups[code] = groups[code] || {
            code,
            name: (m.group_name && m.group_code) ? m.group_name : 'Administration',
            sequence: parseInt(m.group_sequence || 999),
            items: []
        };
        const children = childrenByParent[m.menu_code] || [];
        if (children.length === 0) {
            addItem(group, m);
        } else {
            children.forEach(c => addItem(group, c));
        }
    });

    return Object.values(groups)
        .filter(g => g.items.length > 0)
        .sort((a, b) => a.sequence - b.sequence)
        .map((g, i) => Object.assign(g, GROUP_TONES[i % GROUP_TONES.length]));
}

// Phones get the tile home; tablets/desktops keep the existing landing page.
function isPhone(req) {
    const ua = (req.headers && req.headers['user-agent']) || '';
    return /Mobi|Android.+Mobile|iPhone|iPod/i.test(ua);
}

module.exports = { buildMobileMenuGroups, isPhone };
