-- =====================================================================
-- ShareBite — Supabase PostgreSQL Schema & Migration Script
-- Compatible with PostgreSQL 15+ and Supabase Hosted Platform
-- Preserves existing SQLite schema, relationships, and constraints.
-- =====================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. USERS TABLE
CREATE TABLE IF NOT EXISTS public.users (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('donor', 'ngo', 'admin')),
    is_verified SMALLINT DEFAULT 0 CHECK (is_verified IN (0, 1)),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON public.users (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_users_role ON public.users (role);

-- 3. NGOS TABLE (Complete 5-Step Registration Profile)
CREATE TABLE IF NOT EXISTS public.ngos (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT UNIQUE NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    org_name VARCHAR(255) NOT NULL,
    org_type VARCHAR(100) NOT NULL DEFAULT 'Registered Trust',
    reg_number VARCHAR(100),
    year_established INTEGER,
    description TEXT,
    website VARCHAR(500),
    logo TEXT,
    
    -- Location details (Step 2)
    country VARCHAR(100) DEFAULT 'India',
    state VARCHAR(100),
    city VARCHAR(100),
    area VARCHAR(150),
    address TEXT NOT NULL,
    pincode VARCHAR(30),
    latitude NUMERIC(10, 6) NOT NULL,
    longitude NUMERIC(10, 6) NOT NULL,
    
    -- Contact details (Step 3)
    phone VARCHAR(50) NOT NULL,
    contact_person VARCHAR(255) NOT NULL,
    contact_designation VARCHAR(150),
    
    -- Legal Verification (Step 4)
    doc_name VARCHAR(255),
    doc_url TEXT,
    verification_status VARCHAR(50) NOT NULL DEFAULT 'pending' 
        CHECK (verification_status IN ('pending', 'verified', 'rejected', 'suspended')),
    
    -- Food capabilities (Step 5)
    accepted_categories JSONB DEFAULT '[]'::jsonb,
    max_quantity NUMERIC(10, 2) DEFAULT 100,
    has_refrigeration SMALLINT DEFAULT 0 CHECK (has_refrigeration IN (0, 1)),
    has_transport SMALLINT DEFAULT 0 CHECK (has_transport IN (0, 1)),
    operating_hours VARCHAR(255) DEFAULT 'Mon-Sat 9AM-7PM',
    collection_time_pref VARCHAR(255) DEFAULT 'Morning & Afternoon',
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ngos_user_id ON public.ngos (user_id);
CREATE INDEX IF NOT EXISTS idx_ngos_verification_status ON public.ngos (verification_status);
CREATE INDEX IF NOT EXISTS idx_ngos_location ON public.ngos (latitude, longitude);

-- 4. DONATIONS TABLE
CREATE TABLE IF NOT EXISTS public.donations (
    id BIGSERIAL PRIMARY KEY,
    food_name VARCHAR(255) NOT NULL,
    food_type VARCHAR(100) NOT NULL,
    quantity NUMERIC(10, 2) NOT NULL CHECK (quantity > 0),
    prepared_date VARCHAR(50) NOT NULL,
    expiry_date VARCHAR(50) NOT NULL,
    pickup_location TEXT NOT NULL,
    latitude NUMERIC(10, 6),
    longitude NUMERIC(10, 6),
    description TEXT,
    image TEXT NOT NULL,
    donor_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
    donor_name VARCHAR(255) NOT NULL,
    donor_email VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'Available' CHECK (status IN ('Available', 'Accepted', 'Completed', 'Cancelled', 'Expired')),
    accepted_by_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
    accepted_by_name VARCHAR(255),
    accepted_by_email VARCHAR(255),
    accepted_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_donations_status ON public.donations (status);
CREATE INDEX IF NOT EXISTS idx_donations_donor_email ON public.donations (LOWER(donor_email));
CREATE INDEX IF NOT EXISTS idx_donations_accepted_by ON public.donations (LOWER(accepted_by_email));
CREATE INDEX IF NOT EXISTS idx_donations_coords ON public.donations (latitude, longitude);

-- 5. SESSIONS TABLE
CREATE TABLE IF NOT EXISTS public.sessions (
    token VARCHAR(255) PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.revoked_sessions (
    token VARCHAR(255) PRIMARY KEY,
    revoked_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. REGISTRATION CHALLENGES TABLE (6-Digit OTP Signup)
CREATE TABLE IF NOT EXISTS public.registration_challenges (
    id BIGSERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL,
    otp_hash VARCHAR(255) NOT NULL,
    otp_expires_at TIMESTAMPTZ NOT NULL,
    failed_attempts INTEGER DEFAULT 0,
    resend_available_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reg_challenges_email ON public.registration_challenges (LOWER(email));

-- 7. PASSWORD RESETS TABLE (6-Digit OTP Reset)
CREATE TABLE IF NOT EXISTS public.password_resets (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    otp_hash VARCHAR(255) NOT NULL,
    otp_expires_at TIMESTAMPTZ NOT NULL,
    is_verified SMALLINT DEFAULT 0 CHECK (is_verified IN (0, 1)),
    reset_token_hash VARCHAR(255),
    reset_token_expires_at TIMESTAMPTZ,
    failed_attempts INTEGER DEFAULT 0,
    resend_available_at TIMESTAMPTZ,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_resets_email ON public.password_resets (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_password_resets_token_hash ON public.password_resets (reset_token_hash);

-- 8. NOTIFICATIONS TABLE
CREATE TABLE IF NOT EXISTS public.notifications (
    id BIGSERIAL PRIMARY KEY,
    user_email VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    is_read SMALLINT DEFAULT 0 CHECK (is_read IN (0, 1)),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_email ON public.notifications (LOWER(user_email));

-- 9. SETTINGS TABLE
CREATE TABLE IF NOT EXISTS public.settings (
    key VARCHAR(255) PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. HAVERSINE DISTANCE FUNCTION (For Supabase SQL Queries)
CREATE OR REPLACE FUNCTION public.haversine_distance(
    lat1 NUMERIC,
    lon1 NUMERIC,
    lat2 NUMERIC,
    lon2 NUMERIC
) RETURNS NUMERIC AS $$
DECLARE
    R NUMERIC := 6371.0; -- Earth radius in km
    dlat NUMERIC;
    dlon NUMERIC;
    a NUMERIC;
    c NUMERIC;
BEGIN
    IF lat1 IS NULL OR lon1 IS NULL OR lat2 IS NULL OR lon2 IS NULL THEN
        RETURN NULL;
    END IF;
    
    dlat := radians(lat2 - lat1);
    dlon := radians(lon2 - lon1);
    
    a := sin(dlat / 2.0)^2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2.0)^2;
    c := 2.0 * atan2(sqrt(a), sqrt(1.0 - a));
    
    RETURN ROUND((R * c)::NUMERIC, 1);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 11. ROW LEVEL SECURITY (RLS) POLICIES
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ngos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.donations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Allow public read of active donations
CREATE POLICY "Public read available donations"
    ON public.donations FOR SELECT
    USING (status = 'Available' OR auth.role() = 'authenticated');

-- Allow donors to create donations
CREATE POLICY "Donors can create donations"
    ON public.donations FOR INSERT
    WITH CHECK (true);

-- Allow authenticated users to view NGO profiles
CREATE POLICY "Public read verified NGOs"
    ON public.ngos FOR SELECT
    USING (true);

COMMENT ON TABLE public.ngos IS 'Stores 5-step NGO registration profiles and confirmed facility coordinates.';
COMMENT ON TABLE public.donations IS 'Food donation listings with straight-line distance matching within 15 km.';
