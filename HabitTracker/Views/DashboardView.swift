import SwiftUI

struct DashboardView: View {
    @StateObject private var service = DashboardService()
    @AppStorage("serverURL") private var serverURL = ""
    @AppStorage("apiToken") private var apiToken = ""
    @State private var isShowingSettings = false

    var body: some View {
        NavigationStack {
            Group {
                if service.isLoading && service.participants.isEmpty {
                    ProgressView("Загрузка…")
                } else if let error = service.errorMessage {
                    ContentUnavailableView(
                        "Не удалось загрузить",
                        systemImage: "wifi.exclamationmark",
                        description: Text(error)
                    )
                } else if service.participants.isEmpty {
                    ContentUnavailableView(
                        "Пока нет участников",
                        systemImage: "person.3",
                        description: Text("Как только кто-то напишет боту в Telegram, данные появятся здесь")
                    )
                } else {
                    List(service.participants) { participant in
                        Section(participant.displayName) {
                            if participant.habits.isEmpty {
                                Text("Пока нет привычек")
                                    .foregroundStyle(.secondary)
                            } else {
                                ForEach(participant.habits) { habit in
                                    HStack {
                                        Image(systemName: habit.isDoneToday ? "checkmark.circle.fill" : "circle")
                                            .foregroundStyle(habit.isDoneToday ? .green : .secondary)
                                        Text(habit.name)
                                        Spacer()
                                        if habit.currentStreak > 0 {
                                            Text("🔥 \(habit.currentStreak)")
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
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
                        Task { await service.refresh(serverURL: serverURL, apiToken: apiToken) }
                    } label: {
                        Label("Обновить", systemImage: "arrow.clockwise")
                    }
                }
            }
            .sheet(isPresented: $isShowingSettings) {
                SettingsView()
            }
            .task {
                await service.refresh(serverURL: serverURL, apiToken: apiToken)
            }
        }
    }
}
