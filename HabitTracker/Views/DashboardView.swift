import SwiftUI

enum DashboardPeriod: String, CaseIterable, Identifiable {
    case daily = "День"
    case weekly = "Неделя"
    case monthly = "Месяц"

    var id: String { rawValue }
}

/// The date range the dashboard shows: the day, Monday-to-Sunday week or
/// month containing `anchor`. Dates go to the server as 'YYYY-MM-DD'.
struct DashboardWindow: Equatable {
    let period: DashboardPeriod
    let anchor: Date

    private static var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.firstWeekday = 2
        return calendar
    }

    private static let isoFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    static func date(from iso: String) -> Date? { isoFormatter.date(from: iso) }

    private var component: Calendar.Component {
        switch period {
        case .daily: return .day
        case .weekly: return .weekOfYear
        case .monthly: return .month
        }
    }

    private var interval: DateInterval {
        Self.calendar.dateInterval(of: component, for: anchor) ?? DateInterval(start: anchor, duration: 86_400)
    }

    var startDate: Date { interval.start }
    var endDate: Date { Self.calendar.date(byAdding: .day, value: -1, to: interval.end) ?? interval.start }

    var from: String { Self.isoFormatter.string(from: startDate) }
    var to: String { Self.isoFormatter.string(from: endDate) }

    var containsToday: Bool { interval.contains(.now) }

    func shifted(by steps: Int) -> DashboardWindow {
        DashboardWindow(period: period, anchor: Self.calendar.date(byAdding: component, value: steps, to: anchor) ?? anchor)
    }

    var title: String {
        let locale = Locale(identifier: "ru_RU")
        switch period {
        case .daily:
            return startDate.formatted(.dateTime.day().month(.wide).year().locale(locale))
        case .weekly:
            let start = startDate.formatted(.dateTime.day().month(.abbreviated).locale(locale))
            let end = endDate.formatted(.dateTime.day().month(.abbreviated).locale(locale))
            return "\(start) – \(end)"
        case .monthly:
            // "LLLL" is the standalone month name: "сентябрь", not "сентября".
            let formatter = DateFormatter()
            formatter.locale = locale
            formatter.dateFormat = "LLLL yyyy"
            return formatter.string(from: startDate).capitalized
        }
    }
}

private struct SelectedParticipant: Identifiable {
    let id: Int
    let displayName: String
}

struct DashboardView: View {
    @StateObject private var service = DashboardService()
    @AppStorage("serverURL") private var serverURL = ""
    @AppStorage("apiToken") private var apiToken = ""
    @AppStorage("dashboardGroup") private var group = ""
    @State private var isShowingSettings = false
    @State private var period: DashboardPeriod = .daily
    @State private var anchor = Date.now
    @State private var selected: SelectedParticipant?

    private var window: DashboardWindow { DashboardWindow(period: period, anchor: anchor) }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                controls
                    .padding()

                content
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .navigationTitle("Дашборд")
            .toolbar {
                ToolbarItem {
                    Button {
                        isShowingSettings = true
                    } label: {
                        Label("Настройки", systemImage: "gearshape")
                    }
                }
                ToolbarItem {
                    Button {
                        Task { await refresh() }
                    } label: {
                        Label("Обновить", systemImage: "arrow.clockwise")
                    }
                }
            }
            .sheet(isPresented: $isShowingSettings, onDismiss: { Task { await refresh() } }) {
                SettingsView()
            }
            .sheet(item: $selected) { participant in
                ParticipantDetailView(
                    participantID: participant.id,
                    displayName: participant.displayName,
                    group: group,
                    window: window
                )
            }
            .task { await refresh() }
            .onChange(of: period) { _, _ in Task { await refresh() } }
            .onChange(of: anchor) { _, _ in Task { await refresh() } }
            .onChange(of: group) { _, _ in Task { await refresh() } }
        }
    }

    private var controls: some View {
        VStack(spacing: 10) {
            HStack(spacing: 12) {
                if !service.groups.isEmpty {
                    Picker("Группа", selection: $group) {
                        ForEach(service.groups) { group in
                            Text(group.name).tag(group.key)
                        }
                    }
                    .pickerStyle(.segmented)
                    .frame(maxWidth: 220)
                }

                Picker("Период", selection: $period) {
                    ForEach(DashboardPeriod.allCases) { period in
                        Text(period.rawValue).tag(period)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
            }

            HStack {
                Button {
                    anchor = window.shifted(by: -1).anchor
                } label: {
                    Image(systemName: "chevron.left")
                }
                .help("Назад")

                Text(window.title)
                    .font(.headline)
                    .frame(minWidth: 200)

                Button {
                    anchor = window.shifted(by: 1).anchor
                } label: {
                    Image(systemName: "chevron.right")
                }
                .disabled(window.containsToday)
                .help("Вперёд")

                if !window.containsToday {
                    Button("Сегодня") { anchor = .now }
                }
            }
            .buttonStyle(.borderless)
        }
    }

    @ViewBuilder
    private var content: some View {
        if service.isLoading && service.participants.isEmpty && service.history.isEmpty {
            ProgressView("Загрузка…")
        } else if let error = service.errorMessage {
            ContentUnavailableView(
                "Не удалось загрузить",
                systemImage: "wifi.exclamationmark",
                description: Text(error)
            )
        } else {
            switch period {
            case .daily:
                DailyRankingView(participants: service.participants) { select($0.id, $0.displayName) }
            case .weekly:
                WeeklyRankingView(participants: service.participants) { select($0.id, $0.displayName) }
            case .monthly:
                MonthlyRankingView(history: service.history, weekStarts: service.weekStarts) {
                    select($0.id, $0.displayName)
                }
            }
        }
    }

    private func select(_ id: Int, _ displayName: String) {
        selected = SelectedParticipant(id: id, displayName: displayName)
    }

    private func refresh() async {
        if service.groups.isEmpty {
            await service.refreshGroups(serverURL: serverURL, apiToken: apiToken)
        }
        guard let first = service.groups.first else { return }
        if !service.groups.contains(where: { $0.key == group }) {
            // Setting the group triggers onChange, which runs the refresh.
            group = first.key
            return
        }
        switch period {
        case .daily, .weekly:
            await service.refreshSnapshot(group: group, window: window, serverURL: serverURL, apiToken: apiToken)
        case .monthly:
            await service.refreshHistory(group: group, window: window, serverURL: serverURL, apiToken: apiToken)
        }
    }
}
