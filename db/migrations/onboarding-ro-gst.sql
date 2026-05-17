-- Add GST number to the onboarding RO details table
ALTER TABLE t_onboarding_ro
    ADD COLUMN gst_number VARCHAR(20) NULL AFTER owner_contact;
