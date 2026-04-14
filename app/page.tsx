import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ReviewQueue from '@/components/ReviewQueue'

export default async function Home() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return <ReviewQueue />
}
