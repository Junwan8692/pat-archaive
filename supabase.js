// Supabase 클라이언트. URL·anon key는 본인 프로젝트 값으로 교체.
// anon key는 공개되어도 안전(RLS로 보호). 자세한 건 README 참고.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://YOUR_PROJECT.supabase.co";   // ← 교체
const SUPABASE_ANON_KEY = "YOUR_ANON_KEY";                  // ← 교체

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
export const STORAGE_BUCKET = "prompts";
