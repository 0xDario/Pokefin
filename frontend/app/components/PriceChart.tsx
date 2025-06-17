import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

export default function PriceChart({ data }: { data: { usd_price: number, recorded_at: string }[] }) {
  const formattedData = data
    .map(d => ({
      date: new Date(d.recorded_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      price: d.usd_price
    }))
    .reverse(); // ensure oldest to newest

  return (
    <ResponsiveContainer width="100%" height={120}>
      <LineChart data={formattedData}>
        <XAxis dataKey="date" hide />
        <YAxis domain={['dataMin', 'dataMax']} hide />
        <Tooltip formatter={(value: number) => `$${value.toFixed(2)}`} />
        <Line type="monotone" dataKey="price" stroke="#3b82f6" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
