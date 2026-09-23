import SwiftUI

/// Shared look for the dashboard views, so every screen colors a percentage
/// and formats a value the same way.
enum DashboardStyle {
    static func percentColor(_ percent: Int) -> Color {
        switch percent {
        case 75...: return .green
        case 40..<75: return .orange
        default: return .red
        }
    }

    static func formatValue(_ value: Double) -> String {
        value.truncatingRemainder(dividingBy: 1) == 0 ? String(Int(value)) : String(format: "%.1f", value)
    }

    /// Green/red for a metric with a value in the window, grey when nothing was entered.
    static func statusColor(_ metric: BaseMetricStatus) -> Color {
        guard metric.hasValue else { return .gray.opacity(0.5) }
        return metric.isGreen ? .green : .red
    }

    static func valueText(_ value: Double, hasValue: Bool) -> String {
        hasValue ? formatValue(value) : "—"
    }

    /// " стр." for a metric with a unit, " дн." for a yes/no metric.
    static func unitSuffix(type: MetricType, unit: String) -> String {
        if type == .check { return " дн." }
        return unit.isEmpty ? "" : " " + unit
    }

    /// "84 / 150 стр." — the total against the target for the window.
    static func progressText(_ metric: BaseMetricStatus) -> String {
        "\(valueText(metric.value, hasValue: metric.hasValue)) / \(formatValue(metric.minValue))"
            + unitSuffix(type: metric.type, unit: metric.unit)
    }

    /// "09.09–16.09", or "22.09" for a single day; nil when there is no period.
    static func periodText(start: String?, end: String?) -> String? {
        guard let start, let end else { return nil }
        func short(_ iso: String) -> String {
            let parts = iso.split(separator: "-")
            return parts.count == 3 ? "\(parts[2]).\(parts[1])" : iso
        }
        return start == end ? short(start) : "\(short(start))–\(short(end))"
    }

    /// Standard competition ranking: equal percentages share a place (1, 2, 2, 4).
    static func ranks(for percents: [Int]) -> [Int] {
        percents.map { percent in 1 + percents.filter { $0 > percent }.count }
    }

    static func medal(forRank rank: Int) -> String? {
        switch rank {
        case 1: return "🥇"
        case 2: return "🥈"
        case 3: return "🥉"
        default: return nil
        }
    }

    static func lastUpdatedText(_ date: Date?) -> String {
        guard let date else { return "ещё не вносил(а) значения" }
        let formatter = RelativeDateTimeFormatter()
        formatter.locale = Locale(identifier: "ru_RU")
        return "обновлено " + formatter.localizedString(for: date, relativeTo: .now)
    }
}

/// Rank badge: a medal for the top three, "#N" for everyone else.
struct RankBadge: View {
    let rank: Int

    var body: some View {
        Group {
            if let medal = DashboardStyle.medal(forRank: rank) {
                Text(medal).font(.title2)
            } else {
                Text("#\(rank)")
                    .font(.headline)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(width: 32, alignment: .leading)
    }
}
