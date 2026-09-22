import SwiftUI

/// Trend view: one row per participant with a small bar-chart of weekly % over the month.
struct MonthlyRankingView: View {
    let history: [ParticipantHistory]
    let weekStarts: [String]
    let onSelect: (ParticipantHistory) -> Void

    var body: some View {
        if history.isEmpty {
            ContentUnavailableView(
                "Пока нет данных",
                systemImage: "chart.bar",
                description: Text("В этой группе пока нет участников. Они появятся, когда выберут группу в боте")
            )
        } else {
            let ranks = DashboardStyle.ranks(for: history.map(\.periodPercent))
            List(Array(history.enumerated()), id: \.element.id) { index, participant in
                Button {
                    onSelect(participant)
                } label: {
                    row(participant, rank: ranks[index])
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func row(_ participant: ParticipantHistory, rank: Int) -> some View {
        HStack(spacing: 12) {
            RankBadge(rank: rank)

            VStack(alignment: .leading, spacing: 4) {
                Text(participant.displayName)
                    .font(.body)
                Text("За месяц: \(participant.periodPercent)%\(trendText(participant.weeklyPercents))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            HStack(alignment: .bottom, spacing: 3) {
                ForEach(Array(participant.weeklyPercents.enumerated()), id: \.offset) { offset, percent in
                    RoundedRectangle(cornerRadius: 2)
                        .fill(DashboardStyle.percentColor(percent))
                        .frame(width: 8, height: max(4, CGFloat(percent) / 100 * 36))
                        .help(weekLabel(offset) + ": \(percent)%")
                }
            }
            .frame(height: 36, alignment: .bottom)
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
    }

    /// Change of the last week against the one before it, e.g. "  ▲ 25".
    private func trendText(_ percents: [Int]) -> String {
        guard percents.count >= 2 else { return "" }
        let delta = percents[percents.count - 1] - percents[percents.count - 2]
        if delta > 0 { return "  ▲ \(delta)" }
        if delta < 0 { return "  ▼ \(-delta)" }
        return ""
    }

    /// "Неделя с 14 сент." for the bar's tooltip.
    private func weekLabel(_ offset: Int) -> String {
        guard offset < weekStarts.count, let start = DashboardWindow.date(from: weekStarts[offset]) else {
            return "Неделя"
        }
        return "Неделя с " + start.formatted(.dateTime.day().month(.abbreviated).locale(Locale(identifier: "ru_RU")))
    }
}
