import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { messages } from '@/drizzle/schema';
import { and, gte, lte, eq } from 'drizzle-orm';

// Define topic dictionaries for trend analysis
const TOPIC_KEYWORDS = {
    burnout: ['overwhelmed', 'burnout', 'exhausted', 'stressed', 'too much work', 'overload', 'overworking', 'work-life balance'],
  salary: ['pay', 'salary', 'compensation', 'raise', 'underpaid', 'remuneration', 'bonus'],
  conflict: ['conflict', 'dispute', 'argument', 'disagree', 'issue with', 'problem with my manager', 'toxic', 'complaint'],
  feedback: ['feedback', 'performance review', 'self-assessment', '1:1', 'one-on-one', 'goals'],
  dei: ['diversity', 'inclusion', 'equity', 'belonging', 'inclusive language', 'bias', 'unfair', 'allyship'],
  promotion: ['promotion', 'career growth', 'next level', 'advancement', 'get promoted', 'career path'],
  training: ['training', 'learn', 'course', 'skill up', 'development', 'education', 'lms'],
};;

type Topic = keyof typeof TOPIC_KEYWORDS;

// This function will be protected and only accessible to admins/HR
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);

  // Authorization check
  if (session?.user?.role !== 'admin') {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 403 });
  }

  try {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    // Fetch messages from the last 7 days
    const recentMessages = await db.select({ content: messages.content })
      .from(messages)
      .where(and(
        eq(messages.role, 'user'),
        gte(messages.createdAt, sevenDaysAgo)
      ));

    // Fetch messages from the 7 days before that for comparison
    const previousMessages = await db.select({ content: messages.content })
      .from(messages)
      .where(and(
        eq(messages.role, 'user'),
        gte(messages.createdAt, fourteenDaysAgo),
        lte(messages.createdAt, sevenDaysAgo)
      ));

    // --- Simple Statistical Analysis ---
    const countTopics = (messageList: { content: string }[]): Record<Topic, number> => {
      const counts = Object.keys(TOPIC_KEYWORDS).reduce((acc, topic) => {
        acc[topic as Topic] = 0;
        return acc;
      }, {} as Record<Topic, number>);

      for (const msg of messageList) {
        const lowerContent = msg.content.toLowerCase();
        for (const topic of Object.keys(TOPIC_KEYWORDS) as Topic[]) {
          if (TOPIC_KEYWORDS[topic].some(keyword => lowerContent.includes(keyword))) {
            counts[topic]++;
          }
        }
      }
      return counts;
    };

    const recentCounts = countTopics(recentMessages);
    const previousCounts = countTopics(previousMessages);

    // --- Trend Detection ---
    const alerts: { topic: Topic; message: string }[] = [];
    for (const topic of Object.keys(recentCounts) as Topic[]) {
      const recent = recentCounts[topic];
      const previous = previousCounts[topic];

      if (recent > 3) { // Threshold to avoid alerts for small numbers
        if (previous === 0) {
          alerts.push({
            topic,
            message: `New trend detected for '${topic}' with ${recent} mentions this week.`,
          });
        } else if (previous > 0) {
          const percentageChange = ((recent - previous) / previous) * 100;
          if (percentageChange > 50) { // Alert if > 50% increase
            alerts.push({
              topic,
              message: `Significant increase in '${topic}' queries: ${recent} mentions, a ${percentageChange.toFixed(0)}% increase from the previous week.`,
            });
          }
        }
      }
    }

    return NextResponse.json({
      time_period: `Last 7 days (${sevenDaysAgo.toDateString()} - ${now.toDateString()})`,
      total_queries_this_week: recentMessages.length,
      total_queries_last_week: previousMessages.length,
      topic_counts: recentCounts,
      alerts,
    });

  } catch (error) {
    console.error('Trend analysis error:', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}
