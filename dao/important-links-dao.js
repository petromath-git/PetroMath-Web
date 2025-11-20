// dao/important-links-dao.js
const db = require("../db/db-connection");
const { QueryTypes, Op } = require('sequelize');
const crypto = require('crypto');

// Encryption configuration
const ENCRYPTION_KEY = process.env.LINKS_ENCRYPTION_KEY || 'petromath-links-default-key-32c'; // 32 chars for AES-256
const IV_LENGTH = 16;

// Encryption helpers
const encrypt = (text) => {
    if (!text) return null;
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY.padEnd(32).slice(0, 32)), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
};

const decrypt = (text) => {
    if (!text) return null;
    try {
        const parts = text.split(':');
        const iv = Buffer.from(parts.shift(), 'hex');
        const encryptedText = Buffer.from(parts.join(':'), 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY.padEnd(32).slice(0, 32)), iv);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString();
    } catch (error) {
        console.error('Decryption error:', error);
        return null;
    }
};

module.exports = {
    
    // Get all categories from lookup
    getCategories: async () => {
        const query = `
            SELECT lookup_id, description, tag
            FROM m_lookup
            WHERE lookup_type = 'LINK_CATEGORY'
              AND CURDATE() BETWEEN start_date_active AND end_date_active
            ORDER BY description
        `;
        return await db.sequelize.query(query, { type: QueryTypes.SELECT });
    },

    // Get all oil companies from lookup
    getOilCompanies: async () => {
        const query = `
            SELECT lookup_id, description
            FROM m_lookup
            WHERE lookup_type = 'OIL_COMPANY'
              AND CURDATE() BETWEEN start_date_active AND end_date_active
            ORDER BY description
        `;
        return await db.sequelize.query(query, { type: QueryTypes.SELECT });
    },

    // Get all active roles
    getRoles: async () => {
        const query = `
            SELECT role_id, role_name, role_display_name
            FROM m_roles
            WHERE is_active = 1
              AND CURDATE() BETWEEN effective_start_date AND effective_end_date
            ORDER BY role_level DESC
        `;
        return await db.sequelize.query(query, { type: QueryTypes.SELECT });
    },

    // Create a new link
    create: async (linkData, roleIds) => {
        const transaction = await db.sequelize.transaction();
        
        try {
            // Encrypt password if provided
            const encryptedPassword = encrypt(linkData.password);
            
            // Insert main link
            const [result] = await db.sequelize.query(`
                INSERT INTO m_important_links 
                (title, url, description, category_id, scope_type, company_id, location_id, 
                 username, password_encrypted, is_published, display_order, created_by, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
            `, {
                replacements: [
                    linkData.title,
                    linkData.url,
                    linkData.description || null,
                    linkData.category_id,
                    linkData.scope_type,
                    linkData.company_id || null,
                    linkData.location_id || null,
                    linkData.username || null,
                    encryptedPassword,
                    linkData.is_published ? 1 : 0,
                    linkData.display_order || 0,
                    linkData.created_by
                ],
                type: QueryTypes.INSERT,
                transaction
            });
            
            const linkId = result;
            
            // Insert role permissions
            if (roleIds && roleIds.length > 0) {
                const roleValues = roleIds.map(roleId => `(${linkId}, ${roleId})`).join(',');
                await db.sequelize.query(`
                    INSERT INTO m_important_link_roles (link_id, role_id) VALUES ${roleValues}
                `, { transaction });
            }
            
            await transaction.commit();
            return linkId;
            
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },

    // Update an existing link
    update: async (linkId, linkData, roleIds) => {
        const transaction = await db.sequelize.transaction();
        
        try {
            // Encrypt password if provided
            const encryptedPassword = linkData.password ? encrypt(linkData.password) : undefined;
            
            // Build update query
            let updateFields = `
                title = ?, url = ?, description = ?, category_id = ?, 
                scope_type = ?, company_id = ?, location_id = ?,
                username = ?, is_published = ?, display_order = ?,
                updated_by = ?, updated_at = NOW()
            `;
            
            let replacements = [
                linkData.title,
                linkData.url,
                linkData.description || null,
                linkData.category_id,
                linkData.scope_type,
                linkData.company_id || null,
                linkData.location_id || null,
                linkData.username || null,
                linkData.is_published ? 1 : 0,
                linkData.display_order || 0,
                linkData.updated_by
            ];
            
            // Only update password if provided
            if (encryptedPassword !== undefined) {
                updateFields = `password_encrypted = ?, ` + updateFields;
                replacements.unshift(encryptedPassword);
            }
            
            await db.sequelize.query(`
                UPDATE m_important_links SET ${updateFields} WHERE link_id = ?
            `, {
                replacements: [...replacements, linkId],
                transaction
            });
            
            // Delete existing role permissions and re-insert
            await db.sequelize.query(`
                DELETE FROM m_important_link_roles WHERE link_id = ?
            `, {
                replacements: [linkId],
                transaction
            });
            
            if (roleIds && roleIds.length > 0) {
                const roleValues = roleIds.map(roleId => `(${linkId}, ${roleId})`).join(',');
                await db.sequelize.query(`
                    INSERT INTO m_important_link_roles (link_id, role_id) VALUES ${roleValues}
                `, { transaction });
            }
            
            await transaction.commit();
            return true;
            
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },

  // Enable a link
    enable: async (linkId, updatedBy) => {
        return await db.sequelize.query(`
            UPDATE m_important_links 
            SET is_published = 1, updated_by = ?, updated_at = NOW()
            WHERE link_id = ?
        `, {
            replacements: [updatedBy, linkId],
            type: QueryTypes.UPDATE
        });
    },

    // Disable a link
    disable: async (linkId, updatedBy) => {
        return await db.sequelize.query(`
            UPDATE m_important_links 
            SET is_published = 0, updated_by = ?, updated_at = NOW()
            WHERE link_id = ?
        `, {
            replacements: [updatedBy, linkId],
            type: QueryTypes.UPDATE
        });
    },

    // Toggle publish status
    togglePublish: async (linkId, updatedBy) => {
        return await db.sequelize.query(`
            UPDATE m_important_links 
            SET is_published = NOT is_published, updated_by = ?, updated_at = NOW()
            WHERE link_id = ?
        `, {
            replacements: [updatedBy, linkId],
            type: QueryTypes.UPDATE
        });
    },

    // Get link by ID (for editing)
    getById: async (linkId) => {
        const query = `
            SELECT 
                l.*,
                cat.description as category_name,
                comp.description as company_name,
                loc.location_name,
                p.Person_Name as created_by_name
            FROM m_important_links l
            LEFT JOIN m_lookup cat ON l.category_id = cat.lookup_id
            LEFT JOIN m_lookup comp ON l.company_id = comp.lookup_id
            LEFT JOIN m_location loc ON l.location_id = loc.location_id
            LEFT JOIN m_persons p ON l.created_by = p.Person_id
            WHERE l.link_id = ?
        `;
        
        const links = await db.sequelize.query(query, {
            replacements: [linkId],
            type: QueryTypes.SELECT
        });
        
        if (links.length === 0) return null;
        
        const link = links[0];
        
        // Decrypt password for display
        link.password_decrypted = decrypt(link.password_encrypted);
        
        // Get associated roles
        const roles = await db.sequelize.query(`
            SELECT role_id FROM m_important_link_roles WHERE link_id = ?
        `, {
            replacements: [linkId],
            type: QueryTypes.SELECT
        });
        
        link.role_ids = roles.map(r => r.role_id);
        
        return link;
    },

    // Get links for management page (filtered by user's permissions)
    getLinksForManagement: async (userRole, userLocationId, userCompanyName) => {
        let whereClause = '';
        
        if (userRole === 'SuperUser') {
            // SuperUser can see all links
            whereClause = '1=1';
        } else if (userRole === 'Admin') {
            // Admin can see: Global + their company + their locations
            whereClause = `
                (l.scope_type = 'GLOBAL' 
                 OR (l.scope_type = 'COMPANY' AND comp.description = ?)
                 OR (l.scope_type = 'LOCATION' AND l.location_id = ?))
            `;
        } else {
            // Manager can only see their location's links
            whereClause = `l.scope_type = 'LOCATION' AND l.location_id = ?`;
        }
        
        const query = `
            SELECT 
                l.*,
                cat.description as category_name,
                comp.description as company_name,
                loc.location_name,
                p.Person_Name as created_by_name,
                GROUP_CONCAT(r.role_name SEPARATOR ', ') as visible_to_roles
            FROM m_important_links l
            LEFT JOIN m_lookup cat ON l.category_id = cat.lookup_id
            LEFT JOIN m_lookup comp ON l.company_id = comp.lookup_id
            LEFT JOIN m_location loc ON l.location_id = loc.location_id
            LEFT JOIN m_persons p ON l.created_by = p.Person_id
            LEFT JOIN m_important_link_roles lr ON l.link_id = lr.link_id
            LEFT JOIN m_roles r ON lr.role_id = r.role_id
            WHERE ${whereClause}
            GROUP BY l.link_id
            ORDER BY l.display_order, l.title
        `;
        
        let replacements = [];
        if (userRole === 'Admin') {
            replacements = [userCompanyName, userLocationId];
        } else if (userRole === 'Manager') {
            replacements = [userLocationId];
        }
        
        return await db.sequelize.query(query, {
            replacements,
            type: QueryTypes.SELECT
        });
    },

    // Get published links visible to user (for viewing page)
    getLinksForViewing: async (userRole, userRoleId, userLocationId, userCompanyName) => {
        const query = `
            SELECT 
                l.*,
                cat.description as category_name,
                comp.description as company_name,
                loc.location_name
            FROM m_important_links l
            INNER JOIN m_important_link_roles lr ON l.link_id = lr.link_id
            LEFT JOIN m_lookup cat ON l.category_id = cat.lookup_id
            LEFT JOIN m_lookup comp ON l.company_id = comp.lookup_id
            LEFT JOIN m_location loc ON l.location_id = loc.location_id
            WHERE l.is_published = 1
              AND lr.role_id = ?
              AND (
                  l.scope_type = 'GLOBAL'
                  OR (l.scope_type = 'COMPANY' AND comp.description = ?)
                  OR (l.scope_type = 'LOCATION' AND l.location_id = ?)
              )
            ORDER BY cat.description, l.display_order, l.title
        `;
        
        const links = await db.sequelize.query(query, {
            replacements: [userRoleId, userCompanyName, userLocationId],
            type: QueryTypes.SELECT
        });
        
        // Decrypt passwords for display
        return links.map(link => ({
            ...link,
            password_decrypted: decrypt(link.password_encrypted)
        }));
    },

    // Check if user can edit/delete a link
    canUserModifyLink: async (linkId, userRole, userLocationId) => {
        if (userRole === 'SuperUser') return true;
        
        const link = await db.important_links.findByPk(linkId);
        if (!link) return false;
        
        if (userRole === 'Admin') {
            // Admin can modify location-specific links for their locations
            // But not Global or Company level
            if (link.scope_type === 'LOCATION' && link.location_id === userLocationId) {
                return true;
            }
        } else if (userRole === 'Manager') {
            // Manager can only modify their own location's links
            if (link.scope_type === 'LOCATION' && link.location_id === userLocationId) {
                return true;
            }
        }
        
        return false;
    }
};