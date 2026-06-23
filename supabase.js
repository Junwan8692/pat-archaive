// Supabase 클라이언트. URL·anon key는 본인 프로젝트 값으로 교체.
// anon key는 공개되어도 안전(RLS로 보호). 자세한 건 README 참고.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://whrnisglpzcvebdttmxc.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indocm5pc2dscHpjdmViZHR0bXhjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxNTc0MjksImV4cCI6MjA5NzczMzQyOX0.U0t7XX44nYhzfx2OS6VAyxo4MZkBZANoUSHWH75QMgE";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
export const STORAGE_BUCKET = "prompts";
