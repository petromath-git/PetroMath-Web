-- Add Selling Price to onboarding metered products, same as t_onboarding_lubes already has.
-- Without it, m_product.price is NULL for MS/HSD/etc. after migrate, but that field is a
-- required, pre-filled input on the live shift-closing form (views/mixins/new-closing-mixins.pug).
ALTER TABLE t_onboarding_metered_products
    ADD COLUMN selling_price DECIMAL(10, 2) NULL AFTER sgst_percent;
