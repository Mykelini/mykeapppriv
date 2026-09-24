-- Weekly Routines & Smart Study Blocks Schema

-- 1. Table `user_routines`
CREATE TABLE user_routines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  day_of_week integer CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sun, 1=Mon, ..., 6=Sat (or 1-7 for Mon-Sun as requested)
  title text NOT NULL,
  start_time text NOT NULL, -- HH:mm
  end_time text NOT NULL, -- HH:mm
  location_name text NOT NULL,
  location_coords jsonb NOT NULL,
  transport_mode text DEFAULT 'driving',
  buffer_minutes integer DEFAULT 10,
  checklist jsonb DEFAULT '[]'::jsonb
);

-- Enable RLS
ALTER TABLE user_routines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own routines"
ON user_routines
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- 2. Table `study_sessions`
CREATE TABLE study_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  subject text NOT NULL,
  duration_minutes integer NOT NULL,
  session_date date NOT NULL,
  completed boolean DEFAULT false
);

-- Enable RLS
ALTER TABLE study_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own study sessions"
ON study_sessions
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
