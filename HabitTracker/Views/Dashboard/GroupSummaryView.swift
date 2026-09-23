import SwiftUI

/// Header above the rankings: group average and how many participants hit
/// each base metric's target, so the group's weak spot is visible at a glance.
struct GroupSummaryView: View {
    let participants: [ParticipantSnapshot]

    private struct MetricShare: Identifiable {
        let id: String
        let name: String
        let greenCount: Int
    }

    private var averagePercent: Int {
        guard !participants.isEmpty else { return 0 }
        let total = participants.reduce(0) { $0 + $1.percentGreen }
        return Int((Double(total) / Double(participants.count)).rounded())
    }

    private var metricShares: [MetricShare] {
        guard let first = participants.first else { return [] }
        return first.metrics.map { metric in
            let key = metric.key ?? metric.name
            let greenCount = participants.filter { participant in
                participant.metrics.contains { ($0.key ?? $0.name) == key && $0.isGreen }
            }.count
            return MetricShare(id: key, name: metric.name, greenCount: greenCount)
        }
    }

    private var weakest: MetricShare? {
        metricShares.min { $0.greenCount < $1.greenCount }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 24) {
                stat(title: "Среднее по группе", value: "\(averagePercent)%", color: DashboardStyle.percentColor(averagePercent))
                stat(title: "Участников", value: "\(participants.count)", color: .primary)
                if let weakest {
                    stat(title: "Слабое место", value: weakest.name, color: .red)
                }
                Spacer()
            }

            HStack(spacing: 6) {
                ForEach(metricShares) { share in
                    metricBar(share)
                }
            }
        }
        .padding(12)
        .background(.quaternary.opacity(0.3), in: RoundedRectangle(cornerRadius: 10))
    }

    private func stat(title: String, value: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.title2.bold())
                .foregroundStyle(color)
        }
    }

    private func metricBar(_ share: MetricShare) -> some View {
        let fraction = participants.isEmpty ? 0 : Double(share.greenCount) / Double(participants.count)
        return VStack(spacing: 4) {
            GeometryReader { proxy in
                ZStack(alignment: .bottom) {
                    RoundedRectangle(cornerRadius: 3)
                        .fill(.quaternary)
                    RoundedRectangle(cornerRadius: 3)
                        .fill(DashboardStyle.percentColor(Int(fraction * 100)))
                        .frame(height: proxy.size.height * fraction)
                }
            }
            .frame(height: 36)
            Text(share.name)
                .font(.caption2)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Text("\(share.greenCount)/\(participants.count)")
                .font(.caption2.monospacedDigit())
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .help("\(share.name): цель выполняют \(share.greenCount) из \(participants.count)")
    }
}
